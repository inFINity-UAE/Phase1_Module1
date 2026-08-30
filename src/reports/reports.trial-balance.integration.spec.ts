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

/**
 * [feature-spec-1.1.H1.md decision #1] Period Trial Balance HTTP + RPC.
 */
(hasSupabase ? describe : describe.skip)(
  'GET /reports/trial-balance (H1 decision #1)',
  () => {
    jest.setTimeout(240_000);

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
        'H1 TB member',
      );
      foreignCompanyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 TB foreign',
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

    it('period with no activity returns empty when include_zero_balance=false', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 TB empty',
      );
      const febPeriodId = await periodIdForMonth(supabase, companyId, '2026-02-01');

      const empty = await http(
        'GET',
        `/reports/trial-balance?company_id=${companyId}&period_id=${febPeriodId}`,
      );
      expect(empty.status).toBe(200);
      expect(empty.json).toEqual([]);
    });

    it('period with prior activity only: opening equals closing', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 TB opening=closing',
      );
      const janPeriodId = await periodIdForMonth(supabase, companyId, '2026-01-01');
      const febPeriodId = await periodIdForMonth(supabase, companyId, '2026-02-01');
      const bankId = await accountIdByNumber(supabase, companyId, '1020');
      const expenseId = await accountIdByNumber(supabase, companyId, '5990');

      const janDraft = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-15',
          narration: 'H1 Jan seed for empty-Feb opening',
          lines: [
            { line_number: 1, account_id: expenseId, debit: 250, credit: 0 },
            { line_number: 2, account_id: bankId, debit: 0, credit: 250 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journalService.post(janDraft.entry.id, INTEGRATION_USER_ID);

      const feb = await http(
        'GET',
        `/reports/trial-balance?company_id=${companyId}&period_id=${febPeriodId}`,
      );
      expect(feb.status).toBe(200);
      const febRows = feb.json as Array<Record<string, unknown>>;
      expect(febRows.length).toBeGreaterThanOrEqual(2);

      for (const row of febRows) {
        expect(money(row.period_debit)).toBe(0);
        expect(money(row.period_credit)).toBe(0);
        expect(money(row.opening_debit)).toBe(money(row.closing_debit));
        expect(money(row.opening_credit)).toBe(money(row.closing_credit));
        expect(money(row.opening_balance)).toBe(money(row.closing_balance));
      }

      const bankRow = febRows.find((r) => r.account_id === bankId);
      const expRow = febRows.find((r) => r.account_id === expenseId);
      expect(bankRow).toBeDefined();
      expect(expRow).toBeDefined();
      expect(money(bankRow!.opening_credit)).toBe(250);
      expect(money(bankRow!.opening_balance)).toBe(-250);
      expect(money(expRow!.opening_debit)).toBe(250);
      expect(money(expRow!.opening_balance)).toBe(250);
    });

    it('period with activity: opening + period = closing (hand fixture)', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 TB activity',
      );
      const janPeriodId = await periodIdForMonth(supabase, companyId, '2026-01-01');
      const febPeriodId = await periodIdForMonth(supabase, companyId, '2026-02-01');
      const bankId = await accountIdByNumber(supabase, companyId, '1020');
      const expenseId = await accountIdByNumber(supabase, companyId, '5990');

      const janDraft = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-15',
          narration: 'H1 Jan prior for activity fixture',
          lines: [
            { line_number: 1, account_id: expenseId, debit: 250, credit: 0 },
            { line_number: 2, account_id: bankId, debit: 0, credit: 250 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journalService.post(janDraft.entry.id, INTEGRATION_USER_ID);

      const febDraft = await journalService.create(
        {
          company_id: companyId,
          period_id: febPeriodId,
          entry_date: '2026-02-10',
          narration: 'H1 Feb activity fixture',
          lines: [
            { line_number: 1, account_id: expenseId, debit: 100, credit: 0 },
            { line_number: 2, account_id: bankId, debit: 0, credit: 100 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journalService.post(febDraft.entry.id, INTEGRATION_USER_ID);

      const result = await http(
        'GET',
        `/reports/trial-balance?company_id=${companyId}&period_id=${febPeriodId}`,
      );
      expect(result.status).toBe(200);
      const rows = result.json as Array<Record<string, unknown>>;
      const bank = rows.find((r) => r.account_id === bankId)!;
      const exp = rows.find((r) => r.account_id === expenseId)!;

      expect(money(bank.opening_debit)).toBe(0);
      expect(money(bank.opening_credit)).toBe(250);
      expect(money(bank.opening_balance)).toBe(-250);
      expect(money(bank.period_debit)).toBe(0);
      expect(money(bank.period_credit)).toBe(100);
      expect(money(bank.closing_debit)).toBe(0);
      expect(money(bank.closing_credit)).toBe(350);
      expect(money(bank.closing_balance)).toBe(-350);
      expect(
        money(bank.opening_balance) +
          (money(bank.period_debit) - money(bank.period_credit)),
      ).toBe(money(bank.closing_balance));

      expect(money(exp.opening_debit)).toBe(250);
      expect(money(exp.opening_credit)).toBe(0);
      expect(money(exp.opening_balance)).toBe(250);
      expect(money(exp.period_debit)).toBe(100);
      expect(money(exp.period_credit)).toBe(0);
      expect(money(exp.closing_debit)).toBe(350);
      expect(money(exp.closing_credit)).toBe(0);
      expect(money(exp.closing_balance)).toBe(350);
      expect(
        money(exp.opening_balance) +
          (money(exp.period_debit) - money(exp.period_credit)),
      ).toBe(money(exp.closing_balance));
    });

    it('closing_balance matches v_trial_balance when all history is in one period', async () => {
      const soloCompanyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 TB reconcile',
      );
      const soloJan = await periodIdForMonth(supabase, soloCompanyId, '2026-01-01');
      const soloBank = await accountIdByNumber(supabase, soloCompanyId, '1020');
      const soloExp = await accountIdByNumber(supabase, soloCompanyId, '5990');

      const draft = await journalService.create(
        {
          company_id: soloCompanyId,
          period_id: soloJan,
          entry_date: '2026-01-20',
          narration: 'H1 reconcile sole period',
          lines: [
            { line_number: 1, account_id: soloExp, debit: 777.5, credit: 0 },
            { line_number: 2, account_id: soloBank, debit: 0, credit: 777.5 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journalService.post(draft.entry.id, INTEGRATION_USER_ID);

      const tb = await http(
        'GET',
        `/reports/trial-balance?company_id=${soloCompanyId}&period_id=${soloJan}`,
      );
      expect(tb.status).toBe(200);
      const periodRows = tb.json as Array<Record<string, unknown>>;

      const { data: viewRows, error } = await supabase.client
        .from('v_trial_balance')
        .select('account_id, balance, total_debit, total_credit')
        .eq('company_id', soloCompanyId);
      if (error) {
        throw error;
      }

      const viewByAccount = new Map(
        (viewRows ?? []).map((r) => [
          r.account_id as string,
          {
            balance: money(r.balance),
            total_debit: money(r.total_debit),
            total_credit: money(r.total_credit),
          },
        ]),
      );

      for (const row of periodRows) {
        const view = viewByAccount.get(String(row.account_id));
        expect(view).toBeDefined();
        expect(money(row.closing_balance)).toBe(view!.balance);
        expect(money(row.closing_debit)).toBe(view!.total_debit);
        expect(money(row.closing_credit)).toBe(view!.total_credit);
        expect(money(row.opening_debit)).toBe(0);
        expect(money(row.opening_credit)).toBe(0);
        expect(money(row.opening_balance)).toBe(0);
      }
    });

    it('cross-tenant company_id spoof returns 403', async () => {
      const foreignPeriod = await periodIdForMonth(
        supabase,
        foreignCompanyId,
        '2026-01-01',
      );
      const result = await http(
        'GET',
        `/reports/trial-balance?company_id=${foreignCompanyId}&period_id=${foreignPeriod}`,
      );
      expect(result.status).toBe(403);
    });

    it('reversal across periods: Period 1 keeps original; Period 2 nets to zero', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 TB reversal cross-period',
      );
      const janPeriodId = await periodIdForMonth(supabase, companyId, '2026-01-01');
      const febPeriodId = await periodIdForMonth(supabase, companyId, '2026-02-01');
      const bankId = await accountIdByNumber(supabase, companyId, '1020');
      const capitalId = await accountIdByNumber(supabase, companyId, '3000');

      const draft = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriodId,
          entry_date: '2026-01-15',
          narration: 'H1 TB cross-period reversal original',
          lines: [
            { line_number: 1, account_id: bankId, debit: 100, credit: 0 },
            { line_number: 2, account_id: capitalId, debit: 0, credit: 100 },
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

      const janTb = await http(
        'GET',
        `/reports/trial-balance?company_id=${companyId}&period_id=${janPeriodId}`,
      );
      expect(janTb.status).toBe(200);
      const janRows = janTb.json as Array<Record<string, unknown>>;
      const janBank = janRows.find((r) => r.account_id === bankId)!;
      expect(money(janBank.closing_balance)).toBe(100);
      expect(money(janBank.period_debit)).toBe(100);
      expect(money(janBank.period_credit)).toBe(0);

      const febTb = await http(
        'GET',
        `/reports/trial-balance?company_id=${companyId}&period_id=${febPeriodId}`,
      );
      expect(febTb.status).toBe(200);
      const febRows = febTb.json as Array<Record<string, unknown>>;
      const febBank = febRows.find((r) => r.account_id === bankId);
      // Net zero from the pair — account omitted when all period+opening nets to zero
      if (febBank) {
        expect(money(febBank.closing_balance)).toBe(0);
      } else {
        expect(febBank).toBeUndefined();
      }
    });

    it('period_id belonging to another company returns 400 (assertPeriodUsableForCompany)', async () => {
      const foreignPeriod = await periodIdForMonth(
        supabase,
        foreignCompanyId,
        '2026-01-01',
      );
      const result = await http(
        'GET',
        `/reports/trial-balance?company_id=${memberCompanyId}&period_id=${foreignPeriod}`,
      );
      expect(result.status).toBe(400);
    });
  },
);
