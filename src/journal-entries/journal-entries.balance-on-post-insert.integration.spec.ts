import { config } from 'dotenv';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

config({ path: resolve(__dirname, '../../.env.local') });

import { Test, TestingModule } from '@nestjs/testing';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { DatabaseModule } from '../database/database.module';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { SupabaseService } from '../database/supabase.service';
import {
  JOURNAL_ENTRIES_REPOSITORY,
} from './journal-entries.repository';
import { SupabaseJournalEntriesRepository } from './journal-entries.repository.supabase';
import { JournalEntriesModule } from './journal-entries.module';
import {
  mintFreshIntegrationCompany,
  INTEGRATION_USER_ID,
} from '../test/integration-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

/**
 * [feature-spec.md decision #46 / §7.16 finding #6]
 * trg_enforce_journal_balance_on_post must fire on INSERT as well as UPDATE.
 */
(hasSupabase ? describe : describe.skip)(
  'enforce_journal_balance_on_post INSERT backstop (decision #46)',
  () => {
    jest.setTimeout(120_000);

    let repository: SupabaseJournalEntriesRepository;
    let supabase: SupabaseService;
    let companyId = '';

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, AccountingPeriodsModule, JournalEntriesModule],
      }).compile();

      repository = module.get(JOURNAL_ENTRIES_REPOSITORY);
      supabase = module.get(SupabaseService);

      companyId = await mintFreshIntegrationCompany(
        supabase,
        'Balance-on-post INSERT backstop',
      );
    }, 120000);

    async function nextEntryNumber(): Promise<number> {
      return repository.getNextEntryNumber(companyId);
    }

    async function getPeriodId(): Promise<string> {
      const { data, error } = await supabase.client
        .from('accounting_periods')
        .select('id')
        .eq('company_id', companyId)
        .limit(1)
        .single();
      if (error || !data) {
        throw error ?? new Error('No accounting period found');
      }
      return data.id;
    }

    async function getTwoAssetAccounts(): Promise<[string, string]> {
      const { data, error } = await supabase.client
        .from('accounts')
        .select('id')
        .eq('company_id', companyId)
        .eq('category', 'asset')
        .limit(2);
      if (error || !data || data.length < 2) {
        throw error ?? new Error('Need at least two asset accounts');
      }
      return [data[0].id, data[1].id];
    }

    it('rejects direct INSERT with status = posted and no lines (INSERT backstop)', async () => {
      const periodId = await getPeriodId();
      const entryNumber = await nextEntryNumber();

      const { data, error } = await supabase.client
        .from('journal_entries')
        .insert({
          company_id: companyId,
          entry_number: entryNumber,
          period_id: periodId,
          entry_date: '2026-01-15',
          entry_type: JournalEntryType.Manual,
          status: JournalEntryStatus.Posted,
          narration: 'illegal insert-as-posted',
          created_by: INTEGRATION_USER_ID,
        })
        .select('id')
        .single();

      // eslint-disable-next-line no-console
      console.log('CASE1 empty INSERT-as-posted:', { data, code: error?.code, message: error?.message });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error!.code).toBe('P0001');
      expect(error!.message).not.toMatch(/record "old" is not assigned/i);
      expect(error!.message).toMatch(/cannot be inserted directly as posted/i);
    });

    it('rejects balanced header-first INSERT-as-posted unconditionally (draft→UPDATE required)', async () => {
      // Even if lines would balance, INSERT-as-posted is forbidden outright —
      // aligned with all four RPCs (draft→lines→UPDATE) and decision #38.
      const periodId = await getPeriodId();
      const entryNumber = await nextEntryNumber();
      const [accA, accB] = await getTwoAssetAccounts();
      const entryId = randomUUID();

      const { data, error } = await supabase.client
        .from('journal_entries')
        .insert({
          id: entryId,
          company_id: companyId,
          entry_number: entryNumber,
          period_id: periodId,
          entry_date: '2026-01-15',
          entry_type: JournalEntryType.Manual,
          status: JournalEntryStatus.Posted,
          narration: 'would-be balanced insert-as-posted',
          created_by: INTEGRATION_USER_ID,
        })
        .select('id')
        .single();

      // eslint-disable-next-line no-console
      console.log('CASE2 balanced header-first INSERT-as-posted:', { data, code: error?.code, message: error?.message });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error!.code).toBe('P0001');
      expect(error!.message).not.toMatch(/record "old" is not assigned/i);
      expect(error!.message).toMatch(/cannot be inserted directly as posted/i);
      expect(error!.message).not.toMatch(/unbalanced/i);

      // Prove the lines themselves would balance — same accounts/amounts succeed
      // via draft→lines→UPDATE (the established RPC pattern).
      const draftNumber = await nextEntryNumber();
      const { data: draft, error: draftError } = await supabase.client
        .from('journal_entries')
        .insert({
          company_id: companyId,
          entry_number: draftNumber,
          period_id: periodId,
          entry_date: '2026-01-15',
          entry_type: JournalEntryType.Manual,
          status: JournalEntryStatus.Draft,
          narration: 'balanced via draft flow',
          created_by: INTEGRATION_USER_ID,
        })
        .select('id')
        .single();

      expect(draftError).toBeNull();
      expect(draft).not.toBeNull();

      const { error: linesError } = await supabase.client.from('journal_lines').insert([
        {
          journal_entry_id: draft!.id,
          line_number: 1,
          account_id: accA,
          debit: 50,
          credit: 0,
        },
        {
          journal_entry_id: draft!.id,
          line_number: 2,
          account_id: accB,
          debit: 0,
          credit: 50,
        },
      ]);
      expect(linesError).toBeNull();

      const { error: postError } = await supabase.client
        .from('journal_entries')
        .update({ status: JournalEntryStatus.Posted })
        .eq('id', draft!.id)
        .eq('status', JournalEntryStatus.Draft);

      expect(postError).toBeNull();

      await supabase.client.from('journal_lines').delete().eq('journal_entry_id', draft!.id);
      await supabase.client.from('journal_entries').delete().eq('id', draft!.id);
    });

    it('rejects UPDATE to posted when lines are unbalanced (existing path unchanged)', async () => {
      const periodId = await getPeriodId();
      const [accA] = await getTwoAssetAccounts();
      const entryNumber = await nextEntryNumber();

      const { data: draft, error: draftError } = await supabase.client
        .from('journal_entries')
        .insert({
          company_id: companyId,
          entry_number: entryNumber,
          period_id: periodId,
          entry_date: '2026-01-15',
          entry_type: JournalEntryType.Manual,
          status: JournalEntryStatus.Draft,
          narration: 'unbalanced draft for UPDATE post',
          created_by: INTEGRATION_USER_ID,
        })
        .select('id')
        .single();

      expect(draftError).toBeNull();

      await supabase.client.from('journal_lines').insert({
        journal_entry_id: draft!.id,
        line_number: 1,
        account_id: accA,
        debit: 100,
        credit: 0,
      });

      const { error: postError } = await supabase.client
        .from('journal_entries')
        .update({ status: JournalEntryStatus.Posted })
        .eq('id', draft!.id);

      expect(postError).not.toBeNull();
      expect(postError!.code).toBe('P0001');
      expect(postError!.message).toMatch(/unbalanced.*posting rejected/i);

      await supabase.client.from('journal_lines').delete().eq('journal_entry_id', draft!.id);
      await supabase.client.from('journal_entries').delete().eq('id', draft!.id);
    });
  },
);
