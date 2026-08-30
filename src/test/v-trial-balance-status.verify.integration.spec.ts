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
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import {
  ensureAuthUser,
  testUserEmail,
  testUserPassword,
} from './company-members.setup';
import {
  INTEGRATION_USER_ID,
  mintFreshIntegrationCompany,
} from './integration-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

function money(n: unknown): number {
  return typeof n === 'number' ? n : Number(n);
}

async function accountId(
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
    throw error ?? new Error(`account ${accountNumber} missing`);
  }
  return data.id as string;
}

async function periodId(
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
    throw error ?? new Error(`period ${periodStart} missing`);
  }
  return data.id as string;
}

async function viewRow(
  supabase: SupabaseService,
  accountId: string,
): Promise<{
  total_debit: number;
  total_credit: number;
  balance: number;
} | null> {
  const { data, error } = await supabase.client
    .from('v_trial_balance')
    .select('total_debit, total_credit, balance')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  return {
    total_debit: money(data.total_debit),
    total_credit: money(data.total_credit),
    balance: money(data.balance),
  };
}

/**
 * [feature-spec.md decision #60] v_trial_balance status-filter regression —
 * DB view + live GET /accounts/:id/trial-balance.
 */
(hasSupabase ? describe : describe.skip)(
  'v_trial_balance status filter (decision #60)',
  () => {
    jest.setTimeout(300_000);

    let app: INestApplication;
    let baseUrl: string;
    let supabase: SupabaseService;
    let journal: JournalEntriesService;
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
      journal = module.get(JournalEntriesService);

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

    it('post+reverse: balance 0 because both ledger-truth sides count (Dr=Cr=100)', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'vTB #60 post-reverse',
      );
      const jan = await periodId(supabase, companyId, '2026-01-01');
      const bankId = await accountId(supabase, companyId, '1020');
      const capitalId = await accountId(supabase, companyId, '3000');

      const draft = await journal.create(
        {
          company_id: companyId,
          period_id: jan,
          entry_date: '2026-01-15',
          narration: '#60 post+reverse',
          lines: [
            { line_number: 1, account_id: bankId, debit: 100, credit: 0 },
            { line_number: 2, account_id: capitalId, debit: 0, credit: 100 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      const posted = await journal.post(draft.entry.id, INTEGRATION_USER_ID);
      await journal.reverse(posted.entry.id, INTEGRATION_USER_ID);

      const row = await viewRow(supabase, bankId);
      expect(row).not.toBeNull();
      // is_ledger_truth_status includes reversed original + posted reversal
      expect(row!.total_debit).toBe(100);
      expect(row!.total_credit).toBe(100);
      expect(row!.balance).toBe(0);
    });

    it('same-direction: reverse one of two posted debits → only net survivor remains', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'vTB #60 same-dir',
      );
      const jan = await periodId(supabase, companyId, '2026-01-01');
      const bankId = await accountId(supabase, companyId, '1020');
      const capitalId = await accountId(supabase, companyId, '3000');

      const first = await journal.create(
        {
          company_id: companyId,
          period_id: jan,
          entry_date: '2026-01-10',
          narration: '#60 first debit',
          lines: [
            { line_number: 1, account_id: bankId, debit: 100, credit: 0 },
            { line_number: 2, account_id: capitalId, debit: 0, credit: 100 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      const postedFirst = await journal.post(first.entry.id, INTEGRATION_USER_ID);

      const second = await journal.create(
        {
          company_id: companyId,
          period_id: jan,
          entry_date: '2026-01-12',
          narration: '#60 second debit (survives)',
          lines: [
            { line_number: 1, account_id: bankId, debit: 100, credit: 0 },
            { line_number: 2, account_id: capitalId, debit: 0, credit: 100 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      await journal.post(second.entry.id, INTEGRATION_USER_ID);

      await journal.reverse(postedFirst.entry.id, INTEGRATION_USER_ID);

      const row = await viewRow(supabase, bankId);
      expect(row).not.toBeNull();
      // first Dr + first-reversal Cr + second Dr → Dr 200 / Cr 100 / bal 100
      expect(row!.total_debit).toBe(200);
      expect(row!.total_credit).toBe(100);
      expect(row!.balance).toBe(100);
    });

    it('draft-only entry does not move the view balance', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'vTB #60 draft',
      );
      const jan = await periodId(supabase, companyId, '2026-01-01');
      const expenseId = await accountId(supabase, companyId, '5990');
      const bankId = await accountId(supabase, companyId, '1020');

      const before = await viewRow(supabase, expenseId);
      expect(before!.total_debit).toBe(0);
      expect(before!.balance).toBe(0);

      await journal.create(
        {
          company_id: companyId,
          period_id: jan,
          entry_date: '2026-01-20',
          narration: '#60 draft only',
          lines: [
            { line_number: 1, account_id: expenseId, debit: 999, credit: 0 },
            { line_number: 2, account_id: bankId, debit: 0, credit: 999 },
          ],
        },
        INTEGRATION_USER_ID,
      );

      const after = await viewRow(supabase, expenseId);
      expect(after!.total_debit).toBe(0);
      expect(after!.total_credit).toBe(0);
      expect(after!.balance).toBe(0);
    });

    it('account with zero journal_lines still appears as 0/0/0', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'vTB #60 empty',
      );
      // 2350 Zakat Payable — unused by this fixture
      const emptyId = await accountId(supabase, companyId, '2350');
      const row = await viewRow(supabase, emptyId);
      expect(row).not.toBeNull();
      expect(row!.total_debit).toBe(0);
      expect(row!.total_credit).toBe(0);
      expect(row!.balance).toBe(0);
    });

    it('pending_approval and rejected entries are excluded', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'vTB #60 pending-rejected',
      );
      const jan = await periodId(supabase, companyId, '2026-01-01');
      const expenseId = await accountId(supabase, companyId, '5990');
      const bankId = await accountId(supabase, companyId, '1020');

      const pending = await journal.create(
        {
          company_id: companyId,
          period_id: jan,
          entry_date: '2026-01-05',
          narration: '#60 pending_approval',
          lines: [
            { line_number: 1, account_id: expenseId, debit: 50, credit: 0 },
            { line_number: 2, account_id: bankId, debit: 0, credit: 50 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      const { error: pendErr } = await supabase.client
        .from('journal_entries')
        .update({ status: JournalEntryStatus.PendingApproval })
        .eq('id', pending.entry.id);
      if (pendErr) {
        throw pendErr;
      }

      const rejected = await journal.create(
        {
          company_id: companyId,
          period_id: jan,
          entry_date: '2026-01-06',
          narration: '#60 rejected',
          lines: [
            { line_number: 1, account_id: expenseId, debit: 75, credit: 0 },
            { line_number: 2, account_id: bankId, debit: 0, credit: 75 },
          ],
        },
        INTEGRATION_USER_ID,
      );
      const { error: rejErr } = await supabase.client
        .from('journal_entries')
        .update({ status: JournalEntryStatus.Rejected })
        .eq('id', rejected.entry.id);
      if (rejErr) {
        throw rejErr;
      }

      const row = await viewRow(supabase, expenseId);
      expect(row!.total_debit).toBe(0);
      expect(row!.total_credit).toBe(0);
      expect(row!.balance).toBe(0);
    });

    it('GET /accounts/:id/trial-balance ignores unposted draft (live route)', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'vTB #60 live route',
      );
      const jan = await periodId(supabase, companyId, '2026-01-01');
      const expenseId = await accountId(supabase, companyId, '5990');
      const bankId = await accountId(supabase, companyId, '1020');

      await journal.create(
        {
          company_id: companyId,
          period_id: jan,
          entry_date: '2026-01-22',
          narration: '#60 live-route draft',
          lines: [
            { line_number: 1, account_id: expenseId, debit: 888, credit: 0 },
            { line_number: 2, account_id: bankId, debit: 0, credit: 888 },
          ],
        },
        INTEGRATION_USER_ID,
      );

      const result = await http('GET', `/accounts/${expenseId}/trial-balance`);
      expect(result.status).toBe(200);
      const body = result.json as Record<string, unknown>;
      expect(body.account_id).toBe(expenseId);
      expect(money(body.total_debit)).toBe(0);
      expect(money(body.total_credit)).toBe(0);
      expect(money(body.balance)).toBe(0);
    });
  },
);
