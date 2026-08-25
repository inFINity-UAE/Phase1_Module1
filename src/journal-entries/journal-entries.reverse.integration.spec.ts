import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { Test, TestingModule } from '@nestjs/testing';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import { JournalEntriesModule } from './journal-entries.module';
import { JournalEntriesService } from './journal-entries.service';
import {
  ensureReverseIntegrationCompanyReady,
  INTEGRATION_USER_ID,
} from '../test/integration-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const USER_ID = INTEGRATION_USER_ID;

(hasSupabase ? describe : describe.skip)(
  'JournalEntriesService reverseEntry atomicity (Supabase integration)',
  () => {
    // Match Stage 13 / advisory-lock: COA clone + live RPCs exceed Jest's 5s default.
    jest.setTimeout(180_000);

    let service: JournalEntriesService;
    let supabase: SupabaseService;
    /** [feature-spec.md decision #19] Fresh company UUID per run. */
    let companyId = '';
    const createdEntryIds: string[] = [];
    let periodId = '';
    let cashAccountId = '';
    let bankAccountId = '';

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, AccountingPeriodsModule, JournalEntriesModule],
      }).compile();

      service = module.get(JournalEntriesService);
      supabase = module.get(SupabaseService);

      companyId = await ensureReverseIntegrationCompanyReady(supabase);

      const { data: period, error: periodError } = await supabase.client
        .from('accounting_periods')
        .select('id')
        .eq('company_id', companyId)
        .eq('period_start', '2026-01-01')
        .single();
      if (periodError || !period) {
        throw periodError ?? new Error('January 2026 period not found');
      }
      periodId = period.id as string;

      const { data: accounts, error: accountsError } = await supabase.client
        .from('accounts')
        .select('id, account_number')
        .eq('company_id', companyId)
        .in('account_number', ['1010', '1020']);
      if (accountsError || !accounts || accounts.length < 2) {
        throw accountsError ?? new Error('Need cash and bank accounts');
      }
      for (const account of accounts) {
        if (account.account_number === '1010') cashAccountId = account.id as string;
        if (account.account_number === '1020') bankAccountId = account.id as string;
      }
    }, 120000);

    afterAll(async () => {
      for (const entryId of createdEntryIds.reverse()) {
        await supabase.client.from('journal_lines').delete().eq('journal_entry_id', entryId);
        await supabase.client.from('journal_entries').delete().eq('id', entryId);
      }
    });

    async function createPostedProbe(narration: string) {
      const draft = await service.create(
        {
          company_id: companyId,
          period_id: periodId,
          entry_date: '2026-01-18',
          narration,
          lines: [
            { line_number: 1, account_id: cashAccountId, debit: 250, credit: 0 },
            { line_number: 2, account_id: bankAccountId, debit: 0, credit: 250 },
          ],
        },
        USER_ID,
      );
      createdEntryIds.push(draft.entry.id);

      const posted = await service.post(draft.entry.id, USER_ID);
      expect(posted.entry.status).toBe(JournalEntryStatus.Posted);
      return posted;
    }

    it('happy path reverse via RPC posts reversal and marks original reversed', async () => {
      const posted = await createPostedProbe('atomic reverse happy-path probe');

      const result = await service.reverse(posted.entry.id, USER_ID);
      createdEntryIds.push(result.reversal.entry.id);

      expect(result.reversal.entry.entry_type).toBe(JournalEntryType.Reversal);
      expect(result.reversal.entry.status).toBe(JournalEntryStatus.Posted);
      expect(result.reversal.entry.reverses_entry_id).toBe(posted.entry.id);
      expect(result.original.entry.status).toBe(JournalEntryStatus.Reversed);
      expect(result.original.entry.reversed_by_entry_id).toBe(result.reversal.entry.id);
      expect(result.reversal.lines).toHaveLength(2);
    }, 30000);

    it(
      'anon-role client cannot execute reverse_journal_entry (decision #10 grant lockdown)',
      async () => {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
        expect(url).toBeTruthy();
        expect(publishableKey).toBeTruthy();

        const posted = await createPostedProbe('atomic reverse anon-permission probe');

        // Publishable key maps to the anon PostgREST role — must not EXECUTE the RPC.
        const anonClient = createClient(url!, publishableKey!);
        const { data, error } = await anonClient.rpc('reverse_journal_entry', {
          p_original_id: posted.entry.id,
          p_created_by: USER_ID,
          p_fail_before_original_update: false,
        });

        expect(data).toBeNull();
        expect(error).not.toBeNull();
        expect(
          error?.code === '42501' ||
            /permission denied|not find the function|insufficient_privilege|PGRST202/i.test(
              error?.message ?? '',
            ),
        ).toBe(true);

        const originalAfter = await service.findOne(posted.entry.id);
        expect(originalAfter.entry.status).toBe(JournalEntryStatus.Posted);
        expect(originalAfter.entry.reversed_by_entry_id).toBeNull();

        // eslint-disable-next-line no-console
        console.log(
          `[PERMS OK] anon RPC rejected: code=${error?.code ?? 'n/a'} message=${error?.message}`,
        );
      },
      30000,
    );

    it(
      'forced failure before original UPDATE rolls back everything — no orphan reversal',
      async () => {
        const posted = await createPostedProbe('atomic reverse forced-failure probe');

        const entryCountBefore = (
          await supabase.client
            .from('journal_entries')
            .select('id', { count: 'exact', head: true })
            .eq('company_id', companyId)
        ).count;

        const lineCountBefore = (
          await supabase.client
            .from('journal_lines')
            .select('id', { count: 'exact', head: true })
            .eq('journal_entry_id', posted.entry.id)
        ).count;

        const { data, error } = await supabase.client.rpc('reverse_journal_entry', {
          p_original_id: posted.entry.id,
          p_created_by: USER_ID,
          p_fail_before_original_update: true,
        });

        expect(data).toBeNull();
        expect(error).not.toBeNull();
        expect(error?.message).toMatch(/SIMULATED_REVERSAL_FAILURE/i);

        const originalAfter = await service.findOne(posted.entry.id);
        expect(originalAfter.entry.status).toBe(JournalEntryStatus.Posted);
        expect(originalAfter.entry.reversed_by_entry_id).toBeNull();

        const { data: orphanReversals, error: orphanError } = await supabase.client
          .from('journal_entries')
          .select('id, status')
          .eq('reverses_entry_id', posted.entry.id);

        if (orphanError) {
          throw orphanError;
        }
        expect(orphanReversals ?? []).toHaveLength(0);

        const entryCountAfter = (
          await supabase.client
            .from('journal_entries')
            .select('id', { count: 'exact', head: true })
            .eq('company_id', companyId)
        ).count;
        expect(entryCountAfter).toBe(entryCountBefore);

        const lineCountAfter = (
          await supabase.client
            .from('journal_lines')
            .select('id', { count: 'exact', head: true })
            .eq('journal_entry_id', posted.entry.id)
        ).count;
        expect(lineCountAfter).toBe(lineCountBefore);

        // eslint-disable-next-line no-console
        console.log(
          '[ATOMIC OK] forced failure before original UPDATE left no orphan reversal/lines; original still posted',
        );

        const recovered = await service.reverse(posted.entry.id, USER_ID);
        createdEntryIds.push(recovered.reversal.entry.id);
        expect(recovered.original.entry.status).toBe(JournalEntryStatus.Reversed);
      },
      30000,
    );
  },
);
