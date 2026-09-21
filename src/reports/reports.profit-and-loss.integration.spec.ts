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
import { SupabaseService } from '../database/supabase.service';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import {
  ensureAuthUser,
  testUserEmail,
  testUserPassword,
} from '../test/company-members.setup';
import {
  INTEGRATION_USER_ID,
  LEGACY_YE_SKIP_CT,
  mintFreshIntegrationCompany,
} from '../test/integration-company.setup';
import { CompanyRole } from '../common/enums/company-role.enum';

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

type PnLBody = {
  period_start: string;
  period_end: string;
  accounts: Array<Record<string, unknown>>;
  total_income: number;
  total_expense: number;
  net_profit: number;
};

/**
 * [feature-spec-1.1.H.md decision #3] Profit & Loss HTTP + RPC.
 */
(hasSupabase ? describe : describe.skip)(
  'GET /reports/profit-and-loss (H1 decision #3)',
  () => {
    jest.setTimeout(360_000);

    let app: INestApplication;
    let baseUrl: string;
    let supabase: SupabaseService;
    let journalService: JournalEntriesService;
    let accessToken = '';

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

    it('full fiscal-year P&L net_profit matches year-end RE transfer', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 PnL YE cross-check',
      );
      const janPeriodId = await periodIdForMonth(supabase, companyId, '2026-01-01');
      const bankId = await accountIdByNumber(supabase, companyId, '1020');
      const incomeId = await accountIdByNumber(supabase, companyId, '4010');
      const expenseId = await accountIdByNumber(supabase, companyId, '5990');
      const reId = await accountIdByNumber(supabase, companyId, '3100');

      const incomeDraft = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-10',
          narration: 'H1 PnL income',
          lines: [
            { line_number: 1, account_id: bankId, debit: 1000, credit: 0 },
            { line_number: 2, account_id: incomeId, debit: 0, credit: 1000 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journalService.post(incomeDraft.entry.id, INTEGRATION_USER_ID);

      const expenseDraft = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-20',
          narration: 'H1 PnL expense',
          lines: [
            { line_number: 1, account_id: expenseId, debit: 350, credit: 0 },
            { line_number: 2, account_id: bankId, debit: 0, credit: 350 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journalService.post(expenseDraft.entry.id, INTEGRATION_USER_ID);

      // P&L before year-end close — YE lines would otherwise net P&L to zero.
      const pnlResult = await http(
        'GET',
        `/reports/profit-and-loss?company_id=${companyId}&period_start=2026-01-01&period_end=2026-12-31`,
      );
      expect(pnlResult.status).toBe(200);
      const pnl = pnlResult.json as PnLBody;
      expect(pnl.total_income).toBe(1000);
      expect(pnl.total_expense).toBe(350);
      expect(pnl.net_profit).toBe(650);

      const ye = await journalService.runYearEndClosing(
        { company_id: companyId, fiscal_year: 2026, ...LEGACY_YE_SKIP_CT },
        INTEGRATION_USER_ID,
        CompanyRole.Owner,
      );
      const reLine = ye.lines.find((l) => l.account_id === reId);
      expect(reLine).toBeDefined();
      const yeNetToRe = money(reLine!.credit) - money(reLine!.debit);
      expect(yeNetToRe).toBe(650);
      expect(pnl.net_profit).toBe(yeNetToRe);
    });

    it('partial-month with no activity: zeros, not an error', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 PnL empty',
      );

      const result = await http(
        'GET',
        `/reports/profit-and-loss?company_id=${companyId}&period_start=2026-03-01&period_end=2026-03-15`,
      );
      expect(result.status).toBe(200);
      const body = result.json as PnLBody;
      expect(body.accounts).toEqual([]);
      expect(body.total_income).toBe(0);
      expect(body.total_expense).toBe(0);
      expect(body.net_profit).toBe(0);
    });

    it('income and expense land on correct sides via normal_balance CASE', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 PnL sides',
      );
      const janPeriodId = await periodIdForMonth(supabase, companyId, '2026-01-01');
      const bankId = await accountIdByNumber(supabase, companyId, '1020');
      const incomeId = await accountIdByNumber(supabase, companyId, '4010');
      const expenseId = await accountIdByNumber(supabase, companyId, '5990');

      // Confirm COA normals: income credit-normal, expense debit-normal.
      const { data: meta } = await supabase.client
        .from('accounts')
        .select('id, category, normal_balance')
        .in('id', [incomeId, expenseId]);
      const incomeMeta = meta!.find((a) => a.id === incomeId)!;
      const expenseMeta = meta!.find((a) => a.id === expenseId)!;
      expect(incomeMeta.category).toBe('income');
      expect(incomeMeta.normal_balance).toBe('credit');
      expect(expenseMeta.category).toBe('expense');
      expect(expenseMeta.normal_balance).toBe('debit');

      const draft = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-08',
          narration: 'H1 PnL side check',
          lines: [
            { line_number: 1, account_id: expenseId, debit: 120, credit: 0 },
            { line_number: 2, account_id: bankId, debit: 0, credit: 40 },
            { line_number: 3, account_id: incomeId, debit: 0, credit: 80 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      // Unbalanced 3-line? 120 debit vs 40+80 credit = balanced.
      await journalService.post(draft.entry.id, INTEGRATION_USER_ID);

      const result = await http(
        'GET',
        `/reports/profit-and-loss?company_id=${companyId}&period_start=2026-01-01&period_end=2026-01-31`,
      );
      expect(result.status).toBe(200);
      const body = result.json as PnLBody;

      const incomeRow = body.accounts.find((a) => a.account_id === incomeId)!;
      const expenseRow = body.accounts.find((a) => a.account_id === expenseId)!;
      // credit-normal income: credit − debit = 80
      expect(money(incomeRow.balance)).toBe(80);
      expect(incomeRow.category).toBe('income');
      // debit-normal expense: debit − credit = 120
      expect(money(expenseRow.balance)).toBe(120);
      expect(expenseRow.category).toBe('expense');
      expect(body.total_income).toBe(80);
      expect(body.total_expense).toBe(120);
      expect(body.net_profit).toBe(-40);
    });

    it('reversal outside range ignored; reversal inside range nets out', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 PnL reverse',
      );
      const janPeriodId = await periodIdForMonth(supabase, companyId, '2026-01-01');
      const bankId = await accountIdByNumber(supabase, companyId, '1020');
      const incomeId = await accountIdByNumber(supabase, companyId, '4010');

      const draft = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-15',
          narration: 'H1 PnL to reverse',
          lines: [
            { line_number: 1, account_id: bankId, debit: 500, credit: 0 },
            { line_number: 2, account_id: incomeId, debit: 0, credit: 500 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      const posted = await journalService.post(draft.entry.id, INTEGRATION_USER_ID);
      const reversed = await journalService.reverse(
        posted.entry.id,
        INTEGRATION_USER_ID,
      );
      expect(reversed.reversal.entry.entry_date).toBe('2026-02-01');

      const janOnly = await http(
        'GET',
        `/reports/profit-and-loss?company_id=${companyId}&period_start=2026-01-01&period_end=2026-01-31`,
      );
      expect(janOnly.status).toBe(200);
      const janBody = janOnly.json as PnLBody;
      expect(janBody.total_income).toBe(500);
      expect(janBody.net_profit).toBe(500);

      const throughFeb = await http(
        'GET',
        `/reports/profit-and-loss?company_id=${companyId}&period_start=2026-01-01&period_end=2026-02-28`,
      );
      expect(throughFeb.status).toBe(200);
      const febBody = throughFeb.json as PnLBody;
      expect(febBody.total_income).toBe(0);
      expect(febBody.net_profit).toBe(0);
      expect(febBody.accounts.find((a) => a.account_id === incomeId)).toBeUndefined();
    });

    it('rejects period_end before period_start with 400', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 PnL bad range',
      );
      const result = await http(
        'GET',
        `/reports/profit-and-loss?company_id=${companyId}&period_start=2026-06-01&period_end=2026-05-01`,
      );
      expect(result.status).toBe(400);
    });
  },
);
