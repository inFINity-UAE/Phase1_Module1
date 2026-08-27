import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { DatabaseModule } from '../database/database.module';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { SupabaseService } from '../database/supabase.service';
import {
  ensurePostIntegrationCompanyReady,
  INTEGRATION_USER_ID,
} from '../test/integration-company.setup';
import { JournalEntriesModule } from './journal-entries.module';
import { JournalEntriesService } from './journal-entries.service';
import {
  JOURNAL_ENTRIES_REPOSITORY,
} from './journal-entries.repository';
import { SupabaseJournalEntriesRepository } from './journal-entries.repository.supabase';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const USER_ID = INTEGRATION_USER_ID;

(hasSupabase ? describe : describe.skip)(
  'JournalEntriesService list + header update (Supabase integration)',
  () => {
    // [feature-spec.md decision #31]
    jest.setTimeout(180_000);

    let service: JournalEntriesService;
    let repository: SupabaseJournalEntriesRepository;
    let supabase: SupabaseService;
    let companyId = '';
    const createdEntryIds: string[] = [];

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, AccountingPeriodsModule, JournalEntriesModule],
      }).compile();

      service = module.get(JournalEntriesService);
      repository = module.get(JOURNAL_ENTRIES_REPOSITORY);
      supabase = module.get(SupabaseService);
      companyId = await ensurePostIntegrationCompanyReady(supabase);
    }, 120000);

    afterAll(async () => {
      for (const entryId of createdEntryIds.reverse()) {
        await supabase.client.from('journal_attachments').delete().eq('journal_entry_id', entryId);
        await supabase.client.from('journal_lines').delete().eq('journal_entry_id', entryId);
        await supabase.client
          .from('journal_entries')
          .delete()
          .eq('id', entryId)
          .neq('status', JournalEntryStatus.Posted);
      }
    });

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

    async function insertDraft(narration: string, entryDate = '2026-01-20'): Promise<string> {
      const periodId = await getPeriodId();
      const entryNumber = await repository.getNextEntryNumber(companyId);
      const { data, error } = await supabase.client
        .from('journal_entries')
        .insert({
          company_id: companyId,
          entry_number: entryNumber,
          period_id: periodId,
          entry_date: entryDate,
          entry_type: JournalEntryType.Manual,
          status: JournalEntryStatus.Draft,
          narration,
          created_by: USER_ID,
        })
        .select('id')
        .single();
      if (error || !data) {
        throw error ?? new Error('Failed to insert draft');
      }
      createdEntryIds.push(data.id);
      return data.id;
    }

    it('lists entries scoped to company_id and filters by status / period_id', async () => {
      const periodId = await getPeriodId();
      const draftId = await insertDraft('list-filter-draft');

      const listed = await service.findAll(companyId);
      expect(listed.some((e) => e.id === draftId)).toBe(true);

      const drafts = await service.findAll(companyId, {
        status: JournalEntryStatus.Draft,
      });
      expect(drafts.every((e) => e.status === JournalEntryStatus.Draft)).toBe(true);
      expect(drafts.some((e) => e.id === draftId)).toBe(true);

      const inPeriod = await service.findAll(companyId, { period_id: periodId });
      expect(inPeriod.every((e) => e.period_id === periodId)).toBe(true);
      expect(inPeriod.some((e) => e.id === draftId)).toBe(true);

      const otherCompany = await service.findAll('00000000-0000-0000-0000-000000000002');
      expect(otherCompany.some((e) => e.id === draftId)).toBe(false);
    });

    it('updates draft header fields', async () => {
      const id = await insertDraft('before-patch');
      const updated = await service.update(
        id,
        {
          narration: 'after-patch',
          reference_number: 'REF-31',
          entry_date: '2026-01-21',
        },
        USER_ID,
      );
      expect(updated.entry.narration).toBe('after-patch');
      expect(updated.entry.reference_number).toBe('REF-31');
      expect(updated.entry.entry_date).toBe('2026-01-21');
      expect(updated.entry.status).toBe(JournalEntryStatus.Draft);
    });

    it('rejects header update when status is not draft', async () => {
      const id = await insertDraft('will-post');
      const { data: accounts } = await supabase.client
        .from('accounts')
        .select('id')
        .eq('company_id', companyId)
        .eq('category', 'asset')
        .limit(2);
      if (!accounts || accounts.length < 2) {
        throw new Error('Need two asset accounts');
      }
      await supabase.client.from('journal_lines').insert([
        {
          journal_entry_id: id,
          line_number: 1,
          account_id: accounts[0].id,
          debit: 10,
          credit: 0,
        },
        {
          journal_entry_id: id,
          line_number: 2,
          account_id: accounts[1].id,
          debit: 0,
          credit: 10,
        },
      ]);
      await supabase.client
        .from('journal_entries')
        .update({ status: JournalEntryStatus.Posted, posted_at: new Date().toISOString() })
        .eq('id', id);

      await expect(
        service.update(id, { narration: 'should-fail' }, USER_ID),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.update(id, { narration: 'should-fail' }, USER_ID),
      ).rejects.toThrow(/only draft headers are editable/i);
    });

    it('blocks direct PostgREST header UPDATE on a posted entry (DB trigger #38)', async () => {
      const id = await insertDraft('posted-header-immutable');
      const { data: accounts } = await supabase.client
        .from('accounts')
        .select('id')
        .eq('company_id', companyId)
        .eq('category', 'asset')
        .limit(2);
      if (!accounts || accounts.length < 2) {
        throw new Error('Need two asset accounts');
      }
      await supabase.client.from('journal_lines').insert([
        {
          journal_entry_id: id,
          line_number: 1,
          account_id: accounts[0].id,
          debit: 10,
          credit: 0,
        },
        {
          journal_entry_id: id,
          line_number: 2,
          account_id: accounts[1].id,
          debit: 0,
          credit: 10,
        },
      ]);
      const { error: postError } = await supabase.client
        .from('journal_entries')
        .update({ status: JournalEntryStatus.Posted, posted_at: new Date().toISOString() })
        .eq('id', id);
      if (postError) {
        throw postError;
      }

      // Bypass JournalEntriesService — raw header mutation on posted row.
      const { error: updateError } = await supabase.client
        .from('journal_entries')
        .update({ narration: 'tampered-via-postgrest' })
        .eq('id', id);

      expect(updateError).not.toBeNull();
      expect(updateError?.code).toBe('P0001');
      expect(updateError?.message).toMatch(
        /Cannot modify header of a non-draft journal entry/i,
      );
    });
  },
);
