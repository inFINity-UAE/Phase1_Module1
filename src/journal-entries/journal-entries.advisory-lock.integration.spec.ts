import { config } from 'dotenv';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

config({ path: resolve(__dirname, '../../.env.local') });

import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseModule } from '../database/database.module';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { JournalEntriesModule } from './journal-entries.module';
import { JournalEntriesService } from './journal-entries.service';
import { SupabaseService } from '../database/supabase.service';
import {
  ensureCompanyWithCoa,
  ensureFiscalYearPeriods,
  getAccountIdByNumber,
} from '../e2e/e2e-company.setup';
import { CompanyRole } from '../common/enums/company-role.enum';
import { ensureCompanyMember, testUserEmail } from '../test/company-members.setup';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { INTEGRATION_USER_ID, LEGACY_YE_SKIP_CT } from '../test/integration-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const USER_ID = INTEGRATION_USER_ID;
const CONCURRENCY = 8;
const FISCAL_YEAR = 2110;
const OTHER_FISCAL_YEAR = 2111;

(hasSupabase ? describe : describe.skip)(
  'Journal entry advisory locks (concurrent load)',
  () => {
    jest.setTimeout(180_000);

    let service: JournalEntriesService;
    let supabase: SupabaseService;

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, AccountingPeriodsModule, JournalEntriesModule],
      }).compile();

      service = module.get(JournalEntriesService);
      supabase = module.get(SupabaseService);
    });

    async function mintCompany(legalName: string, years: number[] = [FISCAL_YEAR]): Promise<string> {
      const companyId = randomUUID();
      await ensureCompanyWithCoa(supabase, companyId, legalName);
      for (const year of years) {
        await ensureFiscalYearPeriods(supabase, companyId, year);
      }
      await ensureCompanyMember(
        supabase,
        companyId,
        USER_ID,
        CompanyRole.Owner,
        testUserEmail(USER_ID),
      );
      return companyId;
    }

    async function createDraft(companyId: string, periodId: string, accA: string, accB: string) {
      return service.create(
        {
          company_id: companyId,
          period_id: periodId,
          entry_date: `${FISCAL_YEAR}-01-15`,
          narration: `concurrent draft ${randomUUID()}`,
          lines: [
            { line_number: 1, account_id: accA, debit: 10, credit: 0 },
            { line_number: 2, account_id: accB, debit: 0, credit: 10 },
          ],
        },
        USER_ID,
      );
    }

    it('N concurrent creates for the same company get unique entry_numbers with no unique-constraint error', async () => {
      const companyId = await mintCompany('Advisory lock entry-number A');
      const periods = await ensureFiscalYearPeriods(supabase, companyId, FISCAL_YEAR);
      const periodId = periods.get(`${FISCAL_YEAR}-01-01`)!;
      const cash = await getAccountIdByNumber(supabase, companyId, '1020');
      const other = await getAccountIdByNumber(supabase, companyId, '1010');

      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENCY }, () => createDraft(companyId, periodId, cash, other)),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected).toHaveLength(0);
      expect(fulfilled).toHaveLength(CONCURRENCY);

      const numbers = fulfilled.map(
        (r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof createDraft>>>).value.entry
          .entry_number,
      );
      expect(new Set(numbers).size).toBe(CONCURRENCY);
    });

    it('concurrent creates for different companies are not serialized on a global lock', async () => {
      const companyA = await mintCompany('Advisory lock entry-number A-cross');
      const companyB = await mintCompany('Advisory lock entry-number B-cross');
      const periodsA = await ensureFiscalYearPeriods(supabase, companyA, FISCAL_YEAR);
      const periodsB = await ensureFiscalYearPeriods(supabase, companyB, FISCAL_YEAR);
      const periodA = periodsA.get(`${FISCAL_YEAR}-01-01`)!;
      const periodB = periodsB.get(`${FISCAL_YEAR}-01-01`)!;
      const cashA = await getAccountIdByNumber(supabase, companyA, '1020');
      const otherA = await getAccountIdByNumber(supabase, companyA, '1010');
      const cashB = await getAccountIdByNumber(supabase, companyB, '1020');
      const otherB = await getAccountIdByNumber(supabase, companyB, '1010');

      const started = Date.now();
      const [resultsA, resultsB] = await Promise.all([
        Promise.all(
          Array.from({ length: CONCURRENCY }, () => createDraft(companyA, periodA, cashA, otherA)),
        ),
        Promise.all(
          Array.from({ length: CONCURRENCY }, () => createDraft(companyB, periodB, cashB, otherB)),
        ),
      ]);
      const elapsedMs = Date.now() - started;

      expect(resultsA).toHaveLength(CONCURRENCY);
      expect(resultsB).toHaveLength(CONCURRENCY);
      expect(new Set(resultsA.map((r) => r.entry.entry_number)).size).toBe(CONCURRENCY);
      expect(new Set(resultsB.map((r) => r.entry.entry_number)).size).toBe(CONCURRENCY);

      // Sequential same-company 2*N creates would take ~2x if a global lock serialized
      // both companies. Company-scoped locks should finish both batches in roughly the
      // time of one batch (plus clone/setup already done). Bound generously for CI.
      expect(elapsedMs).toBeLessThan(60_000);
      // eslint-disable-next-line no-console
      console.log(`[lock] different-company 8+8 creates elapsedMs=${elapsedMs}`);
    });

    it('N concurrent year-end closes: exactly one succeeds, rest YEAR_END_ALREADY_CLOSED', async () => {
      const companyId = await mintCompany('Advisory lock year-end');
      const periods = await ensureFiscalYearPeriods(supabase, companyId, FISCAL_YEAR);
      const periodId = periods.get(`${FISCAL_YEAR}-01-01`)!;
      const cash = await getAccountIdByNumber(supabase, companyId, '1020');
      const income = await getAccountIdByNumber(supabase, companyId, '4000');

      const pl = await service.create(
        {
          company_id: companyId,
          period_id: periodId,
          entry_date: `${FISCAL_YEAR}-01-20`,
          narration: 'P&L for concurrent year-end',
          lines: [
            { line_number: 1, account_id: cash, debit: 1000, credit: 0 },
            { line_number: 2, account_id: income, debit: 0, credit: 1000 },
          ],
        },
        USER_ID,
      );
      await service.post(pl.entry.id, USER_ID);

      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENCY }, () =>
          service.runYearEndClosing(
            {
              company_id: companyId,
              fiscal_year: FISCAL_YEAR,
              entry_date: `${FISCAL_YEAR}-12-31`,
              ...LEGACY_YE_SKIP_CT,
            },
            USER_ID,
            CompanyRole.Owner,
          ),
        ),
      );

      const ok = results.filter((r) => r.status === 'fulfilled');
      const fail = results.filter((r) => r.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(fail).toHaveLength(CONCURRENCY - 1);

      for (const r of fail) {
        expect(r.status).toBe('rejected');
        const reason = (r as PromiseRejectedResult).reason as Error;
        expect(reason).toBeInstanceOf(BadRequestException);
        expect(String(reason.message)).toMatch(
          `A year-end closing entry already exists for fiscal year ${FISCAL_YEAR}`,
        );
        expect(String(reason.message)).not.toMatch(/deadlock|timeout/i);
      }
    });

    it('concurrent year-end closes for different fiscal years of the same company both succeed', async () => {
      const companyId = await mintCompany('Advisory lock year-end FY split', [
        FISCAL_YEAR,
        OTHER_FISCAL_YEAR,
      ]);
      const periodsA = await ensureFiscalYearPeriods(supabase, companyId, FISCAL_YEAR);
      const periodsB = await ensureFiscalYearPeriods(supabase, companyId, OTHER_FISCAL_YEAR);
      const janA = periodsA.get(`${FISCAL_YEAR}-01-01`)!;
      const janB = periodsB.get(`${OTHER_FISCAL_YEAR}-01-01`)!;
      const cash = await getAccountIdByNumber(supabase, companyId, '1020');
      const income = await getAccountIdByNumber(supabase, companyId, '4000');

      const plA = await service.create(
        {
          company_id: companyId,
          period_id: janA,
          entry_date: `${FISCAL_YEAR}-01-20`,
          narration: 'P&L FY A',
          lines: [
            { line_number: 1, account_id: cash, debit: 200, credit: 0 },
            { line_number: 2, account_id: income, debit: 0, credit: 200 },
          ],
        },
        USER_ID,
      );
      await service.post(plA.entry.id, USER_ID);

      const plB = await service.create(
        {
          company_id: companyId,
          period_id: janB,
          entry_date: `${OTHER_FISCAL_YEAR}-01-20`,
          narration: 'P&L FY B',
          lines: [
            { line_number: 1, account_id: cash, debit: 300, credit: 0 },
            { line_number: 2, account_id: income, debit: 0, credit: 300 },
          ],
        },
        USER_ID,
      );
      await service.post(plB.entry.id, USER_ID);

      const [closeA, closeB] = await Promise.all([
        service.runYearEndClosing(
          {
            company_id: companyId,
            fiscal_year: FISCAL_YEAR,
            entry_date: `${FISCAL_YEAR}-12-31`,
            ...LEGACY_YE_SKIP_CT,
          },
          USER_ID,
          CompanyRole.Owner,
        ),
        service.runYearEndClosing(
          {
            company_id: companyId,
            fiscal_year: OTHER_FISCAL_YEAR,
            entry_date: `${OTHER_FISCAL_YEAR}-12-31`,
            ...LEGACY_YE_SKIP_CT,
          },
          USER_ID,
          CompanyRole.Owner,
        ),
      ]);

      expect(closeA.entry.id).not.toBe(closeB.entry.id);
      expect(closeA.entry.status).toBe(JournalEntryStatus.Posted);
      expect(closeB.entry.status).toBe(JournalEntryStatus.Posted);
    });

    it('N concurrent opening balances: exactly one succeeds, rest already-exists', async () => {
      const companyId = await mintCompany('Advisory lock opening-balance');
      const cash = await getAccountIdByNumber(supabase, companyId, '1020');
      const capital = await getAccountIdByNumber(supabase, companyId, '3000');

      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENCY }, () =>
          service.createOpeningBalance(
            {
              company_id: companyId,
              fiscal_year: FISCAL_YEAR,
              entry_date: `${FISCAL_YEAR}-01-01`,
              narration: 'concurrent opening',
              lines: [
                { line_number: 1, account_id: cash, debit: 50_000, credit: 0 },
                { line_number: 2, account_id: capital, debit: 0, credit: 50_000 },
              ],
            },
            USER_ID,
          ),
        ),
      );

      const ok = results.filter((r) => r.status === 'fulfilled');
      const fail = results.filter((r) => r.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(fail).toHaveLength(CONCURRENCY - 1);

      for (const r of fail) {
        const reason = (r as PromiseRejectedResult).reason as Error;
        expect(reason).toBeInstanceOf(BadRequestException);
        expect(String(reason.message)).toMatch(
          `An opening balance entry already exists for fiscal year ${FISCAL_YEAR}`,
        );
        expect(String(reason.message)).not.toMatch(/deadlock|timeout/i);
      }
    });

    it('opening-balance and year-end for the same company+FY do not deadlock (ob:/ye: namespaces)', async () => {
      const companyId = await mintCompany('Advisory lock ob-vs-ye');
      const periods = await ensureFiscalYearPeriods(supabase, companyId, FISCAL_YEAR);
      const periodId = periods.get(`${FISCAL_YEAR}-01-01`)!;
      const cash = await getAccountIdByNumber(supabase, companyId, '1020');
      const capital = await getAccountIdByNumber(supabase, companyId, '3000');
      const income = await getAccountIdByNumber(supabase, companyId, '4000');

      const pl = await service.create(
        {
          company_id: companyId,
          period_id: periodId,
          entry_date: `${FISCAL_YEAR}-01-20`,
          narration: 'P&L before concurrent ob+ye',
          lines: [
            { line_number: 1, account_id: cash, debit: 400, credit: 0 },
            { line_number: 2, account_id: income, debit: 0, credit: 400 },
          ],
        },
        USER_ID,
      );
      await service.post(pl.entry.id, USER_ID);

      const [ob, ye] = await Promise.all([
        service.createOpeningBalance(
          {
            company_id: companyId,
            fiscal_year: FISCAL_YEAR,
            entry_date: `${FISCAL_YEAR}-01-01`,
            narration: 'OB concurrent with YE',
            lines: [
              { line_number: 1, account_id: cash, debit: 10_000, credit: 0 },
              { line_number: 2, account_id: capital, debit: 0, credit: 10_000 },
            ],
          },
          USER_ID,
        ),
        service.runYearEndClosing(
          {
            company_id: companyId,
            fiscal_year: FISCAL_YEAR,
            entry_date: `${FISCAL_YEAR}-12-31`,
            ...LEGACY_YE_SKIP_CT,
          },
          USER_ID,
          CompanyRole.Owner,
        ),
      ]);

      expect(ob.entry.entry_type).toBe(JournalEntryType.OpeningBalance);
      expect(ye.entry.entry_type).toBe(JournalEntryType.YearEndClosing);
      expect(ob.entry.id).not.toBe(ye.entry.id);
    });
  },
);
