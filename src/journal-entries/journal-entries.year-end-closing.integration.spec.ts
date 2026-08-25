import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { Test, TestingModule } from '@nestjs/testing';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { PeriodStatus } from '../common/enums/period-status.enum';
import { DatabaseModule } from '../database/database.module';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { SupabaseService } from '../database/supabase.service';
import { JOURNAL_ENTRIES_REPOSITORY } from './journal-entries.repository';
import { SupabaseJournalEntriesRepository } from './journal-entries.repository.supabase';
import { JournalEntriesModule } from './journal-entries.module';
import { JournalEntriesService } from './journal-entries.service';
import { CreateYearEndClosingDto } from './dto/create-year-end-closing.dto';
import {
  ensureYearEndIntegrationCompanyReady,
  INTEGRATION_USER_ID,
} from '../test/integration-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const USER_ID = INTEGRATION_USER_ID;
const FISCAL_YEAR = 2026;

async function resolveImbalanceProbeFiscalYear(
  repository: SupabaseJournalEntriesRepository,
  companyId: string,
): Promise<number> {
  for (let year = 2027; year <= 2100; year += 1) {
    const hasClosing = await repository.hasYearEndClosingForFiscalYear(companyId, year);
    if (!hasClosing) {
      return year;
    }
  }

  throw new Error(`No unused fiscal year found for imbalance probe on company ${companyId}`);
}

(hasSupabase ? describe : describe.skip)(
  'JournalEntriesService year-end closing (Supabase integration)',
  () => {
    let service: JournalEntriesService;
    let repository: SupabaseJournalEntriesRepository;
    let supabase: SupabaseService;
    /** [feature-spec.md decision #19] Fresh company UUID per run. */
    let companyId = '';
    const createdEntryIds: string[] = [];
    let incomeAccountId = '';
    let expenseAccountId = '';
    let cashAccountId = '';
    let retainedEarningsId = '';
    let closingPeriodId = '';
    let yearEndAlreadyClosed = false;

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, AccountingPeriodsModule, JournalEntriesModule],
      }).compile();

      service = module.get(JournalEntriesService);
      repository = module.get(JOURNAL_ENTRIES_REPOSITORY);
      supabase = module.get(SupabaseService);

      companyId = await ensureYearEndIntegrationCompanyReady(supabase);

      const { data: accounts, error: accountsError } = await supabase.client
        .from('accounts')
        .select('id, account_number, category')
        .eq('company_id', companyId)
        .in('account_number', ['4000', '5100', '1010', '3100']);
      if (accountsError || !accounts) {
        throw accountsError ?? new Error('Required accounts not found');
      }

      for (const account of accounts) {
        if (account.account_number === '4000') {
          incomeAccountId = account.id;
        } else if (account.account_number === '5100') {
          expenseAccountId = account.id;
        } else if (account.account_number === '1010') {
          cashAccountId = account.id;
        } else if (account.account_number === '3100') {
          retainedEarningsId = account.id;
        }
      }

      const { data: period, error: periodError } = await supabase.client
        .from('accounting_periods')
        .select('id')
        .eq('company_id', companyId)
        .eq('fiscal_year', FISCAL_YEAR)
        .order('period_end', { ascending: false })
        .limit(1)
        .single();
      if (periodError || !period) {
        throw periodError ?? new Error('Closing period not found');
      }
      closingPeriodId = period.id;

      yearEndAlreadyClosed = await repository.hasYearEndClosingForFiscalYear(
        companyId,
        FISCAL_YEAR,
      );
    }, 120000);

    afterAll(async () => {
      for (const entryId of createdEntryIds.reverse()) {
        await supabase.client.from('journal_lines').delete().eq('journal_entry_id', entryId);
        await supabase.client.from('journal_entries').delete().eq('id', entryId);
      }
    });

    async function nextEntryNumber(): Promise<number> {
      return repository.getNextEntryNumber(companyId);
    }

    async function ensureDecemberPeriod(fiscalYear: number): Promise<string> {
      const periodStart = `${fiscalYear}-12-01`;
      const periodEnd = `${fiscalYear}-12-31`;

      const { data: existing, error: existingError } = await supabase.client
        .from('accounting_periods')
        .select('id')
        .eq('company_id', companyId)
        .eq('period_start', periodStart)
        .maybeSingle();

      if (existingError) {
        throw existingError;
      }

      if (existing) {
        return existing.id as string;
      }

      const { data: inserted, error: insertError } = await supabase.client
        .from('accounting_periods')
        .insert({
          company_id: companyId,
          period_start: periodStart,
          period_end: periodEnd,
          fiscal_year: fiscalYear,
          status: PeriodStatus.Open,
        })
        .select('id')
        .single();

      if (insertError || !inserted) {
        throw insertError ?? new Error(`Failed to create period ${periodStart}`);
      }

      return inserted.id as string;
    }

    async function insertPostedPlEntry(
      periodId: string,
      incomeAmount: number,
      expenseAmount: number,
      narration: string,
      entryDate: string,
    ): Promise<string> {
      const entryNumber = await nextEntryNumber();
      const postedAt = new Date().toISOString();

      const { data: entry, error: entryError } = await supabase.client
        .from('journal_entries')
        .insert({
          company_id: companyId,
          entry_number: entryNumber,
          period_id: periodId,
          entry_date: entryDate,
          entry_type: JournalEntryType.Manual,
          status: JournalEntryStatus.Posted,
          narration,
          created_by: USER_ID,
          posted_at: postedAt,
        })
        .select('id')
        .single();

      if (entryError || !entry) {
        throw entryError ?? new Error('Failed to insert P&L entry');
      }

      createdEntryIds.push(entry.id);

      const { error: linesError } = await supabase.client.from('journal_lines').insert([
        {
          journal_entry_id: entry.id,
          line_number: 1,
          account_id: cashAccountId,
          debit: incomeAmount - expenseAmount,
          credit: 0,
        },
        {
          journal_entry_id: entry.id,
          line_number: 2,
          account_id: expenseAccountId,
          debit: expenseAmount,
          credit: 0,
        },
        {
          journal_entry_id: entry.id,
          line_number: 3,
          account_id: incomeAccountId,
          debit: 0,
          credit: incomeAmount,
        },
      ]);

      if (linesError) {
        throw linesError;
      }

      return entry.id;
    }

    async function getAccountBalance(accountId: string): Promise<number> {
      const row = await repository.getAccountTrialBalance(companyId, accountId);
      return row?.balance ?? 0;
    }

    it(
      'year-end close zeroes income/expense, posts net to Retained Earnings, and leaves balance-sheet unchanged',
      async () => {
        if (yearEndAlreadyClosed) {
          return;
        }
        const incomeBefore = await getAccountBalance(incomeAccountId);
        const expenseBefore = await getAccountBalance(expenseAccountId);
        const cashBefore = await getAccountBalance(cashAccountId);
        const reBefore = await getAccountBalance(retainedEarningsId);

        await insertPostedPlEntry(
          closingPeriodId,
          1000,
          600,
          'Integration P&L activity for year-end close',
          '2026-02-15',
        );

        const incomeAfterPl = await getAccountBalance(incomeAccountId);
        const expenseAfterPl = await getAccountBalance(expenseAccountId);
        expect(incomeAfterPl).toBe(incomeBefore + 1000);
        expect(expenseAfterPl).toBe(expenseBefore + 600);

        const dto: CreateYearEndClosingDto = {
          company_id: companyId,
          fiscal_year: FISCAL_YEAR,
        };

        const result = await service.runYearEndClosing(dto, USER_ID);
        createdEntryIds.push(result.entry.id);
        yearEndAlreadyClosed = true;

        expect(result.entry.entry_type).toBe(JournalEntryType.YearEndClosing);
        expect(result.entry.status).toBe(JournalEntryStatus.Posted);
        expect(result.entry.posted_at).toBeTruthy();

        const totalDebit = result.lines.reduce((sum, line) => sum + Number(line.debit), 0);
        const totalCredit = result.lines.reduce((sum, line) => sum + Number(line.credit), 0);
        expect(totalDebit).toBeCloseTo(totalCredit, 2);

        expect(await getAccountBalance(incomeAccountId)).toBeCloseTo(0, 2);
        expect(await getAccountBalance(expenseAccountId)).toBeCloseTo(0, 2);
        expect(await getAccountBalance(cashAccountId)).toBeCloseTo(cashBefore + 400, 2);
        expect(await getAccountBalance(retainedEarningsId)).toBeCloseTo(reBefore + 400, 2);
      },
      30000,
    );

    it(
      'rejects year-end close when the fiscal year has periods but no P&L balances',
      async () => {
      const emptyFiscalYear = await resolveImbalanceProbeFiscalYear(repository, companyId);
      await ensureDecemberPeriod(emptyFiscalYear);

      const dto: CreateYearEndClosingDto = {
        company_id: companyId,
        fiscal_year: emptyFiscalYear,
      };

      await expect(service.runYearEndClosing(dto, USER_ID)).rejects.toThrow(
        `No income or expense balances to close for fiscal year ${emptyFiscalYear}`,
      );

      expect(
        await repository.hasYearEndClosingForFiscalYear(companyId, emptyFiscalYear),
      ).toBe(false);
      },
      30000,
    );

    it('attempting year-end close a second time is rejected with no new entry', async () => {
      const alreadyClosed = await repository.hasYearEndClosingForFiscalYear(
        companyId,
        FISCAL_YEAR,
      );
      if (!alreadyClosed) {
        const dto: CreateYearEndClosingDto = {
          company_id: companyId,
          fiscal_year: FISCAL_YEAR,
        };
        const firstClose = await service.runYearEndClosing(dto, USER_ID);
        createdEntryIds.push(firstClose.entry.id);
        yearEndAlreadyClosed = true;
      }
      const dto: CreateYearEndClosingDto = {
        company_id: companyId,
        fiscal_year: FISCAL_YEAR,
      };

      const incomeBefore = await getAccountBalance(incomeAccountId);
      const reBefore = await getAccountBalance(retainedEarningsId);
      const entryCountBefore = (
        await supabase.client
          .from('journal_entries')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId)
          .eq('entry_type', JournalEntryType.YearEndClosing)
          .eq('period_id', closingPeriodId)
      ).count;

      await expect(service.runYearEndClosing(dto, USER_ID)).rejects.toThrow(
        `A year-end closing entry already exists for fiscal year ${FISCAL_YEAR}`,
      );

      const entryCountAfter = (
        await supabase.client
          .from('journal_entries')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId)
          .eq('entry_type', JournalEntryType.YearEndClosing)
          .eq('period_id', closingPeriodId)
      ).count;

      expect(entryCountAfter).toBe(entryCountBefore);
      expect(await getAccountBalance(incomeAccountId)).toBeCloseTo(incomeBefore, 2);
      expect(await getAccountBalance(retainedEarningsId)).toBeCloseTo(reBefore, 2);
    }, 30000);
  },
);
