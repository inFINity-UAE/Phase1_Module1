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

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

type BalanceSheetBody = {
  as_of_date: string;
  accounts: Array<Record<string, unknown>>;
  total_assets: number;
  total_liabilities: number;
  total_equity: number;
  is_balanced: boolean;
};

type PnLBody = {
  period_start: string;
  period_end: string;
  accounts: Array<Record<string, unknown>>;
  total_income: number;
  total_expense: number;
  net_profit: number;
};

type TbRow = {
  account_id: string;
  account_number: string;
  category: string;
  closing_balance: number;
};

type GlRow = {
  account_id: string;
  account_number: string;
  entry_date: string;
  debit: number;
  credit: number;
  line_balance: number;
  running_balance: number;
  journal_entry_id: string;
  narration: string | null;
};

/**
 * [feature-spec-1.1.H1.md decision #6] Cross-report integrity sweep —
 * Module 1.1.A lifecycle (multi-period posts, reverse, year-end) then
 * assert TB / BS / P&L / GL agree with each other and with journal_lines.
 * Extends the TC11 (YE) + TC12 (reversal) patterns into one shared fixture.
 */
(hasSupabase ? describe : describe.skip)(
  'H1-5 cross-report integrity sweep (decision #6)',
  () => {
    jest.setTimeout(420_000);

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

    it('multi-period lifecycle: TB / BS / P&L / GL agree with ledger and each other', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'H1-5 integrity sweep',
      );

      const janPeriodId = await periodIdForMonth(supabase, companyId, '2026-01-01');
      const febPeriodId = await periodIdForMonth(supabase, companyId, '2026-02-01');
      const decPeriodId = await periodIdForMonth(supabase, companyId, '2026-12-01');

      const bankId = await accountIdByNumber(supabase, companyId, '1020');
      const apId = await accountIdByNumber(supabase, companyId, '2000');
      const capitalId = await accountIdByNumber(supabase, companyId, '3000');
      const reId = await accountIdByNumber(supabase, companyId, '3100');
      const incomeId = await accountIdByNumber(supabase, companyId, '4010');
      const expenseId = await accountIdByNumber(supabase, companyId, '5990');

      // ── Lifecycle (TC11 YE + TC12 reverse patterns, multi-period) ─────────
      // Jan 05: Dr Bank 10,000 / Cr Capital 10,000  (equity)
      // Jan 12: Dr Expense 500 / Cr AP 500          (to reverse — liability)
      // Jan 20: Dr Bank 5,000 / Cr Income 5,000     (income)
      // Feb 10: Dr Expense 1,200 / Cr Bank 1,200    (expense, period 2)
      // Reverse Jan 12 → reversal on 2026-02-01
      // YE 2026 → RE = income 5,000 − expense (500−500+1,200) = 3,800

      const capital = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-05',
          narration: 'H1-5 share capital',
          lines: [
            { line_number: 1, account_id: bankId, debit: 10000, credit: 0 },
            { line_number: 2, account_id: capitalId, debit: 0, credit: 10000 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journalService.post(capital.entry.id, INTEGRATION_USER_ID);

      // A/L/E-complete as_of before open P&L / YE — is_balanced must be true.
      const bsCapitalOnly = await http(
        'GET',
        `/reports/balance-sheet?company_id=${companyId}&as_of_date=2026-01-05`,
      );
      expect(bsCapitalOnly.status).toBe(200);
      const bsCap = bsCapitalOnly.json as BalanceSheetBody;
      expect(bsCap.is_balanced).toBe(true);
      expect(bsCap.total_assets).toBe(10000);
      expect(bsCap.total_equity).toBe(10000);

      const toReverse = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-12',
          narration: 'H1-5 AP expense to reverse',
          lines: [
            { line_number: 1, account_id: expenseId, debit: 500, credit: 0 },
            { line_number: 2, account_id: apId, debit: 0, credit: 500 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journalService.post(toReverse.entry.id, INTEGRATION_USER_ID);

      const income = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-20',
          narration: 'H1-5 January sales',
          lines: [
            { line_number: 1, account_id: bankId, debit: 5000, credit: 0 },
            { line_number: 2, account_id: incomeId, debit: 0, credit: 5000 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journalService.post(income.entry.id, INTEGRATION_USER_ID);

      const febExpense = await journalService.create(
        {
          company_id: companyId,
          period_id: febPeriodId,
          entry_date: '2026-02-10',
          narration: 'H1-5 February cash expense',
          lines: [
            { line_number: 1, account_id: expenseId, debit: 1200, credit: 0 },
            { line_number: 2, account_id: bankId, debit: 0, credit: 1200 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journalService.post(febExpense.entry.id, INTEGRATION_USER_ID);

      const reversed = await journalService.reverse(
        toReverse.entry.id,
        INTEGRATION_USER_ID,
      );
      expect(reversed.reversal.entry.entry_date).toBe('2026-02-01');

      // Reversal present on BS as-of before reversal date; absent (net) after.
      const bsBeforeReversal = await http(
        'GET',
        `/reports/balance-sheet?company_id=${companyId}&as_of_date=2026-01-31`,
      );
      expect(bsBeforeReversal.status).toBe(200);
      const bsJan = bsBeforeReversal.json as BalanceSheetBody;
      const apJan = bsJan.accounts.find((a) => a.account_id === apId);
      expect(apJan).toBeDefined();
      expect(money(apJan!.balance)).toBe(500);

      const bsAfterReversal = await http(
        'GET',
        `/reports/balance-sheet?company_id=${companyId}&as_of_date=2026-02-28`,
      );
      expect(bsAfterReversal.status).toBe(200);
      const bsFeb = bsAfterReversal.json as BalanceSheetBody;
      expect(bsFeb.accounts.find((a) => a.account_id === apId)).toBeUndefined();

      // P&L FY 2026 BEFORE year-end (YE zeroing would hide the NI check).
      const pnlBeforeYe = await http(
        'GET',
        `/reports/profit-and-loss?company_id=${companyId}&period_start=2026-01-01&period_end=2026-12-31`,
      );
      expect(pnlBeforeYe.status).toBe(200);
      const pnlFy = pnlBeforeYe.json as PnLBody;
      expect(pnlFy.total_income).toBe(5000);
      expect(pnlFy.total_expense).toBe(1200);
      expect(pnlFy.net_profit).toBe(3800);

      // Mid-year open P&L: decision #2 — A/L/E-only BS may show is_balanced
      // false; imbalance must equal unclosed NI (reports agree with ledger).
      const bsPreYe = await http(
        'GET',
        `/reports/balance-sheet?company_id=${companyId}&as_of_date=2026-12-30`,
      );
      expect(bsPreYe.status).toBe(200);
      const bsPre = bsPreYe.json as BalanceSheetBody;
      const preGap = roundMoney(
        bsPre.total_assets - bsPre.total_liabilities - bsPre.total_equity,
      );
      expect(preGap).toBe(pnlFy.net_profit);

      const ye = await journalService.runYearEndClosing(
        { company_id: companyId, fiscal_year: 2026, ...LEGACY_YE_SKIP_CT },
        INTEGRATION_USER_ID,
        CompanyRole.Owner,
      );
      const reLine = ye.lines.find((l) => l.account_id === reId);
      expect(reLine).toBeDefined();
      const yeNetToRe = money(reLine!.credit) - money(reLine!.debit);
      expect(yeNetToRe).toBe(3800);
      expect(pnlFy.net_profit).toBe(yeNetToRe);

      // ── Final-state cross-report agreement ───────────────────────────────
      const bsAfterYe = await http(
        'GET',
        `/reports/balance-sheet?company_id=${companyId}&as_of_date=2026-12-31`,
      );
      expect(bsAfterYe.status).toBe(200);
      const bsFinal = bsAfterYe.json as BalanceSheetBody;
      expect(bsFinal.is_balanced).toBe(true);
      expect(bsFinal.total_assets).toBe(
        roundMoney(bsFinal.total_liabilities + bsFinal.total_equity),
      );

      const tbResult = await http(
        'GET',
        `/reports/trial-balance?company_id=${companyId}&period_id=${decPeriodId}&include_zero_balance=true`,
      );
      expect(tbResult.status).toBe(200);
      const tbRows = tbResult.json as TbRow[];

      let tbAssets = 0;
      let tbLiab = 0;
      let tbEquity = 0;
      for (const row of tbRows) {
        const bal = money(row.closing_balance);
        if (row.category === 'asset') tbAssets += bal;
        else if (row.category === 'liability') tbLiab += bal;
        else if (row.category === 'equity') tbEquity += bal;
      }
      expect(roundMoney(tbAssets)).toBe(bsFinal.total_assets);
      expect(roundMoney(tbLiab)).toBe(bsFinal.total_liabilities);
      expect(roundMoney(tbEquity)).toBe(bsFinal.total_equity);

      for (const row of tbRows) {
        if (row.category === 'income' || row.category === 'expense') {
          expect(money(row.closing_balance)).toBe(0);
        }
      }

      const pnlNextFy = await http(
        'GET',
        `/reports/profit-and-loss?company_id=${companyId}&period_start=2027-01-01&period_end=2027-12-31`,
      );
      expect(pnlNextFy.status).toBe(200);
      const pnl2027 = pnlNextFy.json as PnLBody;
      expect(pnl2027.net_profit).toBe(0);
      expect(pnl2027.total_income).toBe(0);
      expect(pnl2027.total_expense).toBe(0);

      const pnlAfterYe = await http(
        'GET',
        `/reports/profit-and-loss?company_id=${companyId}&period_start=2026-01-01&period_end=2026-12-31`,
      );
      expect(pnlAfterYe.status).toBe(200);
      expect((pnlAfterYe.json as PnLBody).net_profit).toBe(0);

      const glRe = await http(
        'GET',
        `/reports/general-ledger?company_id=${companyId}&account_id=${reId}`,
      );
      expect(glRe.status).toBe(200);
      const glRows = glRe.json as GlRow[];
      expect(glRows.length).toBeGreaterThanOrEqual(1);
      const glLineSum = roundMoney(
        glRows.reduce((s, r) => s + money(r.line_balance), 0),
      );
      const glFinalRunning = money(glRows[glRows.length - 1].running_balance);
      expect(glLineSum).toBe(glFinalRunning);

      const bsRe = bsFinal.accounts.find((a) => a.account_id === reId);
      expect(bsRe).toBeDefined();
      expect(glFinalRunning).toBe(money(bsRe!.balance));
      expect(glFinalRunning).toBe(3800);

      const glAp = await http(
        'GET',
        `/reports/general-ledger?company_id=${companyId}&account_id=${apId}`,
      );
      expect(glAp.status).toBe(200);
      const apGl = glAp.json as GlRow[];
      expect(apGl.length).toBeGreaterThanOrEqual(2);
      expect(money(apGl[apGl.length - 1].running_balance)).toBe(0);

      const glBank = await http(
        'GET',
        `/reports/general-ledger?company_id=${companyId}&account_id=${bankId}`,
      );
      expect(glBank.status).toBe(200);
      const bankGl = glBank.json as GlRow[];
      const bankBs = bsFinal.accounts.find((a) => a.account_id === bankId);
      expect(bankBs).toBeDefined();
      expect(money(bankGl[bankGl.length - 1].running_balance)).toBe(
        money(bankBs!.balance),
      );
    });
  },
);
