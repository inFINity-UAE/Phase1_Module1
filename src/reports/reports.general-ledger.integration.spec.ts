import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import {
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { AddressInfo } from 'net';
import { Test, TestingModule } from '@nestjs/testing';
import { createClient } from '@supabase/supabase-js';
import { AppModule } from '../app.module';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { CompanyRole } from '../common/enums/company-role.enum';
import { SupabaseService } from '../database/supabase.service';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import {
  ensureAuthUser,
  ensureCompanyMember,
  testUserEmail,
  testUserPassword,
} from '../test/company-members.setup';
import {
  INTEGRATION_USER_ID,
  mintFreshIntegrationCompany,
} from '../test/integration-company.setup';
import { GeneralLedgerRow } from './entities/general-ledger-row.entity';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

async function accountIdByNumber(
  supabase: SupabaseService,
  companyId: string,
  accountNumber: string,
): Promise<string> {
  const { data, error } = await supabase.client
    .from('accounts')
    .select('id')
    .eq('company_id', companyId)
    .eq('account_number', accountNumber)
    .single();
  if (error || !data) {
    throw error ?? new Error(`Account ${accountNumber} not found`);
  }
  return data.id as string;
}

async function periodIdForMonth(
  supabase: SupabaseService,
  companyId: string,
  periodStart: string,
): Promise<string> {
  const { data, error } = await supabase.client
    .from('accounting_periods')
    .select('id')
    .eq('company_id', companyId)
    .eq('period_start', periodStart)
    .single();
  if (error || !data) {
    throw error ?? new Error(`Period ${periodStart} not found`);
  }
  return data.id as string;
}

function money(n: unknown): number {
  return typeof n === 'number' ? n : Number(n);
}

/**
 * [feature-spec-1.1.H1.md decision #5] General Ledger — line-level listing
 * with true cumulative running balance (date filters do not reset).
 */
(hasSupabase ? describe : describe.skip)(
  'GET /reports/general-ledger (H1 decision #5)',
  () => {
    jest.setTimeout(360_000);

    let app: INestApplication;
    let baseUrl: string;
    let supabase: SupabaseService;
    let journalService: JournalEntriesService;
    let accessToken = '';
    let memberCompanyId = '';
    let foreignCompanyId = '';

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = module.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: true },
        }),
      );
      await app.init();
      await app.listen(0);
      const address = app.getHttpServer().address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;

      supabase = module.get(SupabaseService);
      journalService = module.get(JournalEntriesService);

      await ensureAuthUser(
        supabase,
        INTEGRATION_USER_ID,
        testUserEmail(INTEGRATION_USER_ID),
      );

      memberCompanyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 GL member',
      );
      foreignCompanyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 GL foreign',
      );

      await supabase.client
        .from('company_members')
        .delete()
        .eq('company_id', foreignCompanyId)
        .eq('user_id', INTEGRATION_USER_ID);

      await ensureCompanyMember(
        supabase,
        memberCompanyId,
        INTEGRATION_USER_ID,
        CompanyRole.Owner,
        testUserEmail(INTEGRATION_USER_ID),
      );

      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
      const userClient = createClient(url, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: login, error: loginError } =
        await userClient.auth.signInWithPassword({
          email: testUserEmail(INTEGRATION_USER_ID),
          password: testUserPassword(),
        });
      if (loginError || !login.session?.access_token) {
        throw loginError ?? new Error('login failed');
      }
      accessToken = login.session.access_token;
    }, 180_000);

    afterAll(async () => {
      await app.close();
    });

    async function http(
      method: string,
      path: string,
    ): Promise<{ status: number; json: unknown }> {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }
      return { status: response.status, json };
    }

    it('full company dump: every posted line, ordered, with correct running balances', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 GL dump',
      );
      const janPeriodId = await periodIdForMonth(supabase, companyId, '2026-01-01');
      const febPeriodId = await periodIdForMonth(supabase, companyId, '2026-02-01');
      const bankId = await accountIdByNumber(supabase, companyId, '1020');
      const capitalId = await accountIdByNumber(supabase, companyId, '3000');
      const expenseId = await accountIdByNumber(supabase, companyId, '5990');

      const e1 = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-10',
          narration: 'H1 GL capital in',
          lines: [
            { line_number: 1, account_id: bankId, debit: 1000, credit: 0 },
            { line_number: 2, account_id: capitalId, debit: 0, credit: 1000 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journalService.post(e1.entry.id, INTEGRATION_USER_ID);

      const e2 = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-20',
          narration: 'H1 GL expense',
          lines: [
            { line_number: 1, account_id: expenseId, debit: 250, credit: 0 },
            { line_number: 2, account_id: bankId, debit: 0, credit: 250 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journalService.post(e2.entry.id, INTEGRATION_USER_ID);

      const e3 = await journalService.create(
        {
          company_id: companyId,
          period_id: febPeriodId,
          entry_date: '2026-02-05',
          narration: 'H1 GL Feb expense',
          lines: [
            { line_number: 1, account_id: expenseId, debit: 50, credit: 0 },
            { line_number: 2, account_id: bankId, debit: 0, credit: 50 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journalService.post(e3.entry.id, INTEGRATION_USER_ID);

      const result = await http(
        'GET',
        `/reports/general-ledger?company_id=${companyId}`,
      );
      expect(result.status).toBe(200);
      const rows = result.json as GeneralLedgerRow[];
      expect(rows).toHaveLength(6);

      // Order: account_number, entry_date, entry_number, line_number
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1];
        const cur = rows[i];
        const key = (r: GeneralLedgerRow) =>
          `${r.account_number}|${r.entry_date}|${String(r.entry_number).padStart(12, '0')}|${String(r.line_number).padStart(4, '0')}`;
        expect(key(prev) <= key(cur)).toBe(true);
      }

      const bankRows = rows.filter((r) => r.account_id === bankId);
      expect(bankRows).toHaveLength(3);
      expect(money(bankRows[0].running_balance)).toBe(1000);
      expect(money(bankRows[1].running_balance)).toBe(750);
      expect(money(bankRows[2].running_balance)).toBe(700);

      const expenseRows = rows.filter((r) => r.account_id === expenseId);
      expect(expenseRows).toHaveLength(2);
      expect(money(expenseRows[0].running_balance)).toBe(250);
      expect(money(expenseRows[1].running_balance)).toBe(300);

      const capitalRows = rows.filter((r) => r.account_id === capitalId);
      expect(capitalRows).toHaveLength(1);
      expect(money(capitalRows[0].running_balance)).toBe(1000);

      // Partition BY account_id: first row of each account starts fresh
      // (running = line_balance), never bleeds from the prior account_number.
      for (const accountRows of [bankRows, capitalRows, expenseRows]) {
        expect(money(accountRows[0].running_balance)).toBe(
          money(accountRows[0].line_balance),
        );
      }
      // Capital sits between bank (1020) and expense (5990) in account_number
      // order — if the window were unpartitioned, capital would start at
      // bank's closing 700 + 1000 = 1700, not 1000.
      expect(money(capitalRows[0].running_balance)).not.toBe(1700);

      // Each account's final running balance reconciles to v_trial_balance.
      for (const [accountId, accountRows] of [
        [bankId, bankRows],
        [capitalId, capitalRows],
        [expenseId, expenseRows],
      ] as const) {
        const { data: tb, error } = await supabase.client
          .from('v_trial_balance')
          .select('balance')
          .eq('account_id', accountId)
          .single();
        if (error || !tb) {
          throw error ?? new Error(`v_trial_balance missing for ${accountId}`);
        }
        expect(money(accountRows[accountRows.length - 1].running_balance)).toBe(
          money(tb.balance),
        );
      }
    });

    it('one account: final running balance matches v_trial_balance', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 GL vs TB',
      );
      const janPeriodId = await periodIdForMonth(supabase, companyId, '2026-01-01');
      const bankId = await accountIdByNumber(supabase, companyId, '1020');
      const capitalId = await accountIdByNumber(supabase, companyId, '3000');

      const draft = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-12',
          narration: 'H1 GL vs TB',
          lines: [
            { line_number: 1, account_id: bankId, debit: 400, credit: 0 },
            { line_number: 2, account_id: capitalId, debit: 0, credit: 400 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journalService.post(draft.entry.id, INTEGRATION_USER_ID);

      const result = await http(
        'GET',
        `/reports/general-ledger?company_id=${companyId}&account_id=${bankId}`,
      );
      expect(result.status).toBe(200);
      const rows = result.json as GeneralLedgerRow[];
      expect(rows.every((r) => r.account_id === bankId)).toBe(true);
      expect(rows.length).toBeGreaterThanOrEqual(1);

      const { data: tb, error } = await supabase.client
        .from('v_trial_balance')
        .select('balance')
        .eq('account_id', bankId)
        .single();
      if (error || !tb) {
        throw error ?? new Error('v_trial_balance row missing');
      }

      expect(money(rows[rows.length - 1].running_balance)).toBe(money(tb.balance));
    });

    it('date-bounded: only in-range lines; running balance carries true opening', async () => {
      // Decision #5: running balance is true cumulative — filters hide rows
      // but do not reset the window to zero. Three bank hits in January;
      // date_from excludes only the first — first returned row must already
      // include the hidden entry's effect (not start at zero / line-only).
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 GL date filter',
      );
      const janPeriodId = await periodIdForMonth(supabase, companyId, '2026-01-01');
      const bankId = await accountIdByNumber(supabase, companyId, '1020');
      const capitalId = await accountIdByNumber(supabase, companyId, '3000');
      const expenseId = await accountIdByNumber(supabase, companyId, '5990');

      const first = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-05',
          narration: 'H1 GL hidden prior',
          lines: [
            { line_number: 1, account_id: bankId, debit: 500, credit: 0 },
            { line_number: 2, account_id: capitalId, debit: 0, credit: 500 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journalService.post(first.entry.id, INTEGRATION_USER_ID);

      const second = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-15',
          narration: 'H1 GL first visible',
          lines: [
            { line_number: 1, account_id: expenseId, debit: 80, credit: 0 },
            { line_number: 2, account_id: bankId, debit: 0, credit: 80 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journalService.post(second.entry.id, INTEGRATION_USER_ID);

      const third = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-25',
          narration: 'H1 GL second visible',
          lines: [
            { line_number: 1, account_id: expenseId, debit: 20, credit: 0 },
            { line_number: 2, account_id: bankId, debit: 0, credit: 20 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journalService.post(third.entry.id, INTEGRATION_USER_ID);

      const result = await http(
        'GET',
        `/reports/general-ledger?company_id=${companyId}&account_id=${bankId}&date_from=2026-01-10&date_to=2026-01-31`,
      );
      expect(result.status).toBe(200);
      const rows = result.json as GeneralLedgerRow[];
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.entry_date >= '2026-01-10')).toBe(true);
      expect(rows.some((r) => r.entry_date === '2026-01-05')).toBe(false);

      // Hidden Jan-05 debit 500 is already in the first returned running balance:
      // 500 − 80 = 420 (not line_balance alone = −80, and not a window reset to 0).
      expect(money(rows[0].line_balance)).toBe(-80);
      expect(money(rows[0].running_balance)).toBe(420);
      expect(money(rows[0].running_balance)).not.toBe(money(rows[0].line_balance));
      expect(money(rows[1].running_balance)).toBe(400);
    });

    it('draft / pending_approval / rejected never appear', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 GL status filter',
      );
      const janPeriodId = await periodIdForMonth(supabase, companyId, '2026-01-01');
      const bankId = await accountIdByNumber(supabase, companyId, '1020');
      const capitalId = await accountIdByNumber(supabase, companyId, '3000');

      const posted = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-05',
          narration: 'H1 GL posted keep',
          lines: [
            { line_number: 1, account_id: bankId, debit: 100, credit: 0 },
            { line_number: 2, account_id: capitalId, debit: 0, credit: 100 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journalService.post(posted.entry.id, INTEGRATION_USER_ID);

      await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-06',
          narration: 'H1 GL draft hide',
          lines: [
            { line_number: 1, account_id: bankId, debit: 999, credit: 0 },
            { line_number: 2, account_id: capitalId, debit: 0, credit: 999 },
          ],
        },
        INTEGRATION_USER_ID,
      );

      const pending = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-07',
          narration: 'H1 GL pending hide',
          lines: [
            { line_number: 1, account_id: bankId, debit: 888, credit: 0 },
            { line_number: 2, account_id: capitalId, debit: 0, credit: 888 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await supabase.client
        .from('journal_entries')
        .update({ status: JournalEntryStatus.PendingApproval })
        .eq('id', pending.entry.id);

      const rejected = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-08',
          narration: 'H1 GL rejected hide',
          lines: [
            { line_number: 1, account_id: bankId, debit: 777, credit: 0 },
            { line_number: 2, account_id: capitalId, debit: 0, credit: 777 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await supabase.client
        .from('journal_entries')
        .update({ status: JournalEntryStatus.Rejected })
        .eq('id', rejected.entry.id);

      const result = await http(
        'GET',
        `/reports/general-ledger?company_id=${companyId}`,
      );
      expect(result.status).toBe(200);
      const rows = result.json as GeneralLedgerRow[];
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.entry_status === 'posted')).toBe(true);
      expect(rows.some((r) => money(r.debit) === 999)).toBe(false);
      expect(rows.some((r) => money(r.debit) === 888)).toBe(false);
      expect(rows.some((r) => money(r.debit) === 777)).toBe(false);
    });

    it('cross-tenant company_id spoofing is rejected with 403', async () => {
      const result = await http(
        'GET',
        `/reports/general-ledger?company_id=${foreignCompanyId}`,
      );
      expect(result.status).toBe(403);
    });
  },
);
