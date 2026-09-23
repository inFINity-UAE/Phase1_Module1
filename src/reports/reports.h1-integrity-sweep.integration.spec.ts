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
import { CustomersService } from '../customers/customers.service';
import { InvoicesService } from '../invoices/invoices.service';
import { ensureFiscalYearPeriods } from '../e2e/e2e-company.setup';
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
import { flattenReportToCsv } from './reports-csv';

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

function unzipStore(buf: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let offset = 0;
  while (offset + 30 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) {
      break;
    }
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const size = buf.readUInt32LE(offset + 18);
    const nameStart = offset + 30;
    const name = buf.slice(nameStart, nameStart + nameLen).toString('utf8');
    const dataStart = nameStart + nameLen + extraLen;
    files.set(name, buf.slice(dataStart, dataStart + size).toString('utf8'));
    offset = dataStart + size;
  }
  return files;
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
 * [feature-spec-1_1_H.md decision #6] Cross-report integrity sweep —
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
    let customersService: CustomersService;
    let invoicesService: InvoicesService;
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
      customersService = module.get(CustomersService);
      invoicesService = module.get(InvoicesService);

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

      // ── H2 (same fixture; H1 assertions above must stay unchanged) ───────
      const pnlJan = await http(
        'GET',
        `/reports/profit-and-loss?company_id=${companyId}&period_start=2026-01-01&period_end=2026-01-31`,
      );
      expect(pnlJan.status).toBe(200);
      const pnlFeb = await http(
        'GET',
        `/reports/profit-and-loss?company_id=${companyId}&period_start=2026-02-01&period_end=2026-02-28`,
      );
      expect(pnlFeb.status).toBe(200);

      // H2-1: comparison totals equal two separate direct P&L calls.
      const cmpRes = await http(
        'GET',
        `/reports/profit-and-loss-comparison?company_id=${companyId}` +
          `&period_a_start=2026-01-01&period_a_end=2026-01-31` +
          `&period_b_start=2026-02-01&period_b_end=2026-02-28`,
      );
      expect(cmpRes.status).toBe(200);
      const cmp = cmpRes.json as {
        period_a: PnLBody;
        period_b: PnLBody;
        accounts: Array<{
          period_a_balance: number;
          period_b_balance: number;
          variance: number;
        }>;
      };
      const pnlJanBody = pnlJan.json as PnLBody;
      const pnlFebBody = pnlFeb.json as PnLBody;
      expect(cmp.period_a.total_income).toBe(pnlJanBody.total_income);
      expect(cmp.period_a.total_expense).toBe(pnlJanBody.total_expense);
      expect(cmp.period_a.net_profit).toBe(pnlJanBody.net_profit);
      expect(cmp.period_b.total_income).toBe(pnlFebBody.total_income);
      expect(cmp.period_b.total_expense).toBe(pnlFebBody.total_expense);
      expect(cmp.period_b.net_profit).toBe(pnlFebBody.net_profit);
      for (const row of cmp.accounts) {
        expect(roundMoney(money(row.variance))).toBe(
          roundMoney(money(row.period_a_balance) - money(row.period_b_balance)),
        );
      }

      // H2-2: range TB over an exact period equals period TB.
      const tbRange = await http(
        'GET',
        `/reports/trial-balance-range?company_id=${companyId}` +
          `&range_start=2026-12-01&range_end=2026-12-31&include_zero_balance=true`,
      );
      expect(tbRange.status).toBe(200);
      expect(tbRange.json).toEqual(tbRows);

      // H2-3: paginated GL reconstructs unpaginated rows + running_balance.
      const glAllRes = await http('GET', `/reports/general-ledger?company_id=${companyId}`);
      expect(glAllRes.status).toBe(200);
      const glAll = glAllRes.json as GlRow[];
      expect(Array.isArray(glAll)).toBe(true);
      expect(glAll.length).toBeGreaterThan(10);
      expect(glAll[0]).not.toHaveProperty('total_count');

      const rebuilt: GlRow[] = [];
      let pageOffset = 0;
      let reportedTotal = Number.POSITIVE_INFINITY;
      while (pageOffset < reportedTotal) {
        const pageRes = await http(
          'GET',
          `/reports/general-ledger?company_id=${companyId}&limit=10&offset=${pageOffset}`,
        );
        expect(pageRes.status).toBe(200);
        const page = pageRes.json as { rows: GlRow[]; total_count: number };
        expect(page.rows).toBeDefined();
        reportedTotal = page.total_count;
        rebuilt.push(...page.rows);
        if (page.rows.length === 0) {
          break;
        }
        pageOffset += 10;
      }
      expect(reportedTotal).toBe(glAll.length);
      expect(rebuilt).toEqual(glAll);

      // H2-4: FY expense-analysis monthly sum equals P&L total_expense.
      const expRes = await http(
        'GET',
        `/reports/expense-analysis?company_id=${companyId}&fiscal_year=2026`,
      );
      expect(expRes.status).toBe(200);
      const expRows = expRes.json as Array<{ month_start: string; amount: number }>;
      const expSum = roundMoney(expRows.reduce((s, r) => s + money(r.amount), 0));
      expect(expSum).toBe((pnlAfterYe.json as PnLBody).total_expense);
      const janExpSum = roundMoney(
        expRows
          .filter((r) => String(r.month_start).slice(0, 7) === '2026-01')
          .reduce((s, r) => s + money(r.amount), 0),
      );
      expect(janExpSum).toBe(pnlJanBody.total_expense);

      // H2-5: 2027 invoice after YE — sales-by-customer vs Sales Revenue P&L.
      await ensureFiscalYearPeriods(supabase, companyId, 2027);
      const customer = await customersService.create({
        company_id: companyId,
        customer_name: 'H2-5 sweep customer',
        trn: `2${Date.now()}`.slice(0, 15),
      });
      const issued = await invoicesService.create(
        {
          company_id: companyId,
          customer_id: customer.id,
          invoice_date: '2027-01-15',
          lines: [
            {
              line_number: 1,
              description: 'H2-5 sales',
              quantity: 1,
              unit_price: 800,
              vat_rate: 5,
              income_account_id: incomeId,
            },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await invoicesService.issue(issued.invoice.id);

      const salesRes = await http(
        'GET',
        `/reports/sales-by-customer?company_id=${companyId}` +
          `&period_start=2027-01-01&period_end=2027-12-31`,
      );
      expect(salesRes.status).toBe(200);
      const salesRows = salesRes.json as Array<{
        customer_id: string;
        total_revenue: number;
      }>;
      const salesTotal = roundMoney(
        salesRows.reduce((s, r) => s + money(r.total_revenue), 0),
      );

      const pnl2027Sales = await http(
        'GET',
        `/reports/profit-and-loss?company_id=${companyId}&period_start=2027-01-01&period_end=2027-12-31`,
      );
      expect(pnl2027Sales.status).toBe(200);
      const { data: salesAccts, error: salesAcctErr } = await supabase.client
        .from('accounts')
        .select('id, account_number, sub_category')
        .eq('company_id', companyId);
      if (salesAcctErr || !salesAccts) {
        throw salesAcctErr ?? new Error('accounts lookup failed');
      }
      const salesAccountIds = new Set(
        salesAccts
          .filter((a) => a.sub_category === 'Sales Revenue')
          .map((a) => a.id as string),
      );
      const pnlSales = roundMoney(
        ((pnl2027Sales.json as PnLBody).accounts ?? [])
          .filter((a) => salesAccountIds.has(String(a.account_id)))
          .reduce((s, a) => s + money(a.balance), 0),
      );
      expect(salesTotal).toBe(pnlSales);
      expect(salesTotal).toBe(800);

      // H2-8: audit pack CSVs match calling each H1 route directly.
      const tbDirect = await http(
        'GET',
        `/reports/trial-balance?company_id=${companyId}&period_id=${decPeriodId}`,
      );
      expect(tbDirect.status).toBe(200);
      const glDirect = await http(
        'GET',
        `/reports/general-ledger?company_id=${companyId}`,
      );
      expect(glDirect.status).toBe(200);

      const pnlPeriod = await http(
        'GET',
        `/reports/profit-and-loss?company_id=${companyId}&period_start=2026-12-01&period_end=2026-12-31`,
      );
      expect(pnlPeriod.status).toBe(200);

      const packResponse = await fetch(
        `${baseUrl}/reports/audit-pack?company_id=${companyId}&period_id=${decPeriodId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      expect(packResponse.status).toBe(200);
      const packBuf = Buffer.from(await packResponse.arrayBuffer());
      const packFiles = unzipStore(packBuf);
      expect(packFiles.get('trial-balance.csv')).toBe(
        flattenReportToCsv(tbDirect.json),
      );
      expect(packFiles.get('balance-sheet.csv')).toBe(
        flattenReportToCsv(bsFinal),
      );
      expect(packFiles.get('profit-and-loss.csv')).toBe(
        flattenReportToCsv(pnlPeriod.json),
      );
      expect(packFiles.get('general-ledger.csv')).toBe(
        flattenReportToCsv(glDirect.json),
      );
    });
  },
);
