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
import { CompanyRole } from '../common/enums/company-role.enum';
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

type BalanceSheetBody = {
  as_of_date: string;
  accounts: Array<Record<string, unknown>>;
  total_assets: number;
  total_liabilities: number;
  total_equity: number;
  is_balanced: boolean;
};

/**
 * [feature-spec-1.1.H1.md decision #2] Balance Sheet HTTP + RPC.
 */
(hasSupabase ? describe : describe.skip)(
  'GET /reports/balance-sheet (H1 decision #2)',
  () => {
    jest.setTimeout(300_000);

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

    it('fresh company, no activity: zeros and is_balanced true', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 BS fresh',
      );

      const result = await http(
        'GET',
        `/reports/balance-sheet?company_id=${companyId}&as_of_date=2026-01-31`,
      );
      expect(result.status).toBe(200);
      const body = result.json as BalanceSheetBody;
      expect(body.as_of_date).toBe('2026-01-31');
      expect(body.accounts).toEqual([]);
      expect(body.total_assets).toBe(0);
      expect(body.total_liabilities).toBe(0);
      expect(body.total_equity).toBe(0);
      expect(body.is_balanced).toBe(true);
    });

    it('after balanced BS entry: assets/equity reflect it, is_balanced true', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 BS posted',
      );
      const janPeriodId = await periodIdForMonth(supabase, companyId, '2026-01-01');
      const bankId = await accountIdByNumber(supabase, companyId, '1020');
      const capitalId = await accountIdByNumber(supabase, companyId, '3000');

      const draft = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-15',
          narration: 'H1 BS capital injection',
          lines: [
            { line_number: 1, account_id: bankId, debit: 1000, credit: 0 },
            { line_number: 2, account_id: capitalId, debit: 0, credit: 1000 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journalService.post(draft.entry.id, INTEGRATION_USER_ID);

      const result = await http(
        'GET',
        `/reports/balance-sheet?company_id=${companyId}&as_of_date=2026-01-31`,
      );
      expect(result.status).toBe(200);
      const body = result.json as BalanceSheetBody;
      expect(body.total_assets).toBe(1000);
      expect(body.total_liabilities).toBe(0);
      expect(body.total_equity).toBe(1000);
      expect(body.is_balanced).toBe(true);

      const bank = body.accounts.find((a) => a.account_id === bankId);
      const capital = body.accounts.find((a) => a.account_id === capitalId);
      expect(money(bank!.balance)).toBe(1000);
      expect(money(capital!.balance)).toBe(1000);
    });

    it('reversal as-of: before shows original; on/after shows reversed out', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 BS reverse',
      );
      const janPeriodId = await periodIdForMonth(supabase, companyId, '2026-01-01');
      const bankId = await accountIdByNumber(supabase, companyId, '1020');
      const capitalId = await accountIdByNumber(supabase, companyId, '3000');

      const draft = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-15',
          narration: 'H1 BS entry to reverse',
          lines: [
            { line_number: 1, account_id: bankId, debit: 750, credit: 0 },
            { line_number: 2, account_id: capitalId, debit: 0, credit: 750 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      const posted = await journalService.post(draft.entry.id, INTEGRATION_USER_ID);
      const reversed = await journalService.reverse(
        posted.entry.id,
        INTEGRATION_USER_ID,
      );

      // reverse_journal_entry posts reversal on next open period start (Feb 1).
      expect(reversed.reversal.entry.entry_date).toBe('2026-02-01');

      const before = await http(
        'GET',
        `/reports/balance-sheet?company_id=${companyId}&as_of_date=2026-01-31`,
      );
      expect(before.status).toBe(200);
      const beforeBody = before.json as BalanceSheetBody;
      expect(beforeBody.total_assets).toBe(750);
      expect(beforeBody.total_equity).toBe(750);
      expect(beforeBody.is_balanced).toBe(true);
      expect(
        money(beforeBody.accounts.find((a) => a.account_id === bankId)!.balance),
      ).toBe(750);

      const after = await http(
        'GET',
        `/reports/balance-sheet?company_id=${companyId}&as_of_date=2026-02-01`,
      );
      expect(after.status).toBe(200);
      const afterBody = after.json as BalanceSheetBody;
      expect(afterBody.total_assets).toBe(0);
      expect(afterBody.total_liabilities).toBe(0);
      expect(afterBody.total_equity).toBe(0);
      expect(afterBody.is_balanced).toBe(true);
      expect(afterBody.accounts.find((a) => a.account_id === bankId)).toBeUndefined();
      expect(
        afterBody.accounts.find((a) => a.account_id === capitalId),
      ).toBeUndefined();
    });

    it('as_of_date before first posted entry: all zeros, not an error', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 BS before-first',
      );
      const janPeriodId = await periodIdForMonth(supabase, companyId, '2026-01-01');
      const bankId = await accountIdByNumber(supabase, companyId, '1020');
      const capitalId = await accountIdByNumber(supabase, companyId, '3000');

      const draft = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-20',
          narration: 'H1 BS first entry',
          lines: [
            { line_number: 1, account_id: bankId, debit: 200, credit: 0 },
            { line_number: 2, account_id: capitalId, debit: 0, credit: 200 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journalService.post(draft.entry.id, INTEGRATION_USER_ID);

      const result = await http(
        'GET',
        `/reports/balance-sheet?company_id=${companyId}&as_of_date=2026-01-10`,
      );
      expect(result.status).toBe(200);
      const body = result.json as BalanceSheetBody;
      expect(body.accounts).toEqual([]);
      expect(body.total_assets).toBe(0);
      expect(body.total_liabilities).toBe(0);
      expect(body.total_equity).toBe(0);
      expect(body.is_balanced).toBe(true);
    });

    it('income/expense accounts never appear even with balances', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 BS exclude-PL',
      );
      const janPeriodId = await periodIdForMonth(supabase, companyId, '2026-01-01');
      const bankId = await accountIdByNumber(supabase, companyId, '1020');
      const expenseId = await accountIdByNumber(supabase, companyId, '5990');
      const incomeId = await accountIdByNumber(supabase, companyId, '4010');

      const expenseDraft = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-12',
          narration: 'H1 BS expense (should not land on BS)',
          lines: [
            { line_number: 1, account_id: expenseId, debit: 80, credit: 0 },
            { line_number: 2, account_id: bankId, debit: 0, credit: 80 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journalService.post(expenseDraft.entry.id, INTEGRATION_USER_ID);

      const incomeDraft = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-13',
          narration: 'H1 BS income (should not land on BS)',
          lines: [
            { line_number: 1, account_id: bankId, debit: 50, credit: 0 },
            { line_number: 2, account_id: incomeId, debit: 0, credit: 50 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journalService.post(incomeDraft.entry.id, INTEGRATION_USER_ID);

      const result = await http(
        'GET',
        `/reports/balance-sheet?company_id=${companyId}&as_of_date=2026-01-31`,
      );
      expect(result.status).toBe(200);
      const body = result.json as BalanceSheetBody;

      expect(body.accounts.some((a) => a.account_id === expenseId)).toBe(false);
      expect(body.accounts.some((a) => a.account_id === incomeId)).toBe(false);
      expect(body.accounts.every((a) =>
        ['asset', 'liability', 'equity'].includes(String(a.category)),
      )).toBe(true);

      // Bank net: -80 + 50 = -30 (debit-normal)
      const bank = body.accounts.find((a) => a.account_id === bankId);
      expect(bank).toBeDefined();
      expect(money(bank!.balance)).toBe(-30);
      // P&L not closed → BS unbalanced until year-end (expected; engine still reports it)
      expect(body.is_balanced).toBe(false);
    });
  },
);
