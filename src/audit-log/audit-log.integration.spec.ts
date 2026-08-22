import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { Test, TestingModule } from '@nestjs/testing';
import { AuditAction } from '../common/enums/audit-action.enum';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { AuditLogModule } from './audit-log.module';
import { AuditLogService } from './audit-log.service';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import {
  AUDIT_LOG_INTEGRATION_COMPANY_ID,
  ensureAuditLogIntegrationCompanyReady,
  INTEGRATION_USER_ID,
} from '../test/integration-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const COMPANY_ID = AUDIT_LOG_INTEGRATION_COMPANY_ID;
const USER_ID = INTEGRATION_USER_ID;

(hasSupabase ? describe : describe.skip)(
  'AuditLogService (Supabase integration)',
  () => {
    let service: AuditLogService;
    let supabase: SupabaseService;
    const createdEntryIds: string[] = [];

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, AuditLogModule],
      }).compile();

      service = module.get(AuditLogService);
      supabase = module.get(SupabaseService);

      await ensureAuditLogIntegrationCompanyReady(supabase);
    }, 120000);

    afterAll(async () => {
      for (const entryId of createdEntryIds.reverse()) {
        await supabase.client.from('journal_lines').delete().eq('journal_entry_id', entryId);
        await supabase.client.from('journal_entries').delete().eq('id', entryId);
      }
    });

    async function nextEntryNumber(): Promise<number> {
      const { data, error } = await supabase.client
        .from('journal_entries')
        .select('entry_number')
        .eq('company_id', COMPANY_ID)
        .order('entry_number', { ascending: false })
        .limit(1);

      if (error) {
        throw error;
      }

      const max = data?.[0]?.entry_number;
      return typeof max === 'number' ? max + 1 : 1;
    }

    async function getPeriodId(): Promise<string> {
      const { data, error } = await supabase.client
        .from('accounting_periods')
        .select('id, period_end')
        .eq('company_id', COMPANY_ID)
        .order('period_start', { ascending: true })
        .limit(1)
        .single();

      if (error || !data) {
        throw error ?? new Error('No accounting period found');
      }

      return data.id;
    }

    async function getNextOpenPeriod(afterPeriodEnd: string): Promise<{ id: string; period_start: string }> {
      const { data, error } = await supabase.client
        .from('accounting_periods')
        .select('id, period_start')
        .eq('company_id', COMPANY_ID)
        .eq('status', 'open')
        .gt('period_start', afterPeriodEnd)
        .order('period_start', { ascending: true })
        .limit(1)
        .single();

      if (error || !data) {
        throw error ?? new Error('No next open period found');
      }

      return data;
    }

    async function getTwoAssetAccounts(): Promise<[string, string]> {
      const { data, error } = await supabase.client
        .from('accounts')
        .select('id')
        .eq('company_id', COMPANY_ID)
        .eq('category', 'asset')
        .limit(2);

      if (error || !data || data.length < 2) {
        throw error ?? new Error('Need at least two asset accounts');
      }

      return [data[0].id, data[1].id];
    }

    async function insertDraftJournalEntry(narration: string): Promise<string> {
      const periodId = await getPeriodId();
      const entryNumber = await nextEntryNumber();

      const { data: entry, error: entryError } = await supabase.client
        .from('journal_entries')
        .insert({
          company_id: COMPANY_ID,
          entry_number: entryNumber,
          period_id: periodId,
          entry_date: '2026-01-15',
          entry_type: JournalEntryType.Manual,
          status: JournalEntryStatus.Draft,
          narration,
          created_by: USER_ID,
        })
        .select('id')
        .single();

      if (entryError || !entry) {
        throw entryError ?? new Error('Failed to insert draft entry');
      }

      createdEntryIds.push(entry.id);
      return entry.id;
    }

    async function insertPostedJournalEntry(
      narration: string,
    ): Promise<{ id: string; lines: Array<{ line_number: number; account_id: string; debit: number; credit: number }> }> {
      const { data: period, error: periodError } = await supabase.client
        .from('accounting_periods')
        .select('id, period_end')
        .eq('company_id', COMPANY_ID)
        .order('period_start', { ascending: true })
        .limit(1)
        .single();

      if (periodError || !period) {
        throw periodError ?? new Error('No accounting period found');
      }

      const [accA, accB] = await getTwoAssetAccounts();
      const entryNumber = await nextEntryNumber();
      const postedAt = new Date().toISOString();
      const lines = [
        { line_number: 1, account_id: accA, debit: 125, credit: 0 },
        { line_number: 2, account_id: accB, debit: 0, credit: 125 },
      ];

      const { data: entry, error: entryError } = await supabase.client
        .from('journal_entries')
        .insert({
          company_id: COMPANY_ID,
          entry_number: entryNumber,
          period_id: period.id,
          entry_date: '2026-01-15',
          entry_type: JournalEntryType.Manual,
          status: JournalEntryStatus.Posted,
          narration,
          created_by: USER_ID,
          posted_at: postedAt,
        })
        .select('id')
        .single();

      if (entryError || !entry) {
        throw entryError ?? new Error('Failed to insert posted entry');
      }

      createdEntryIds.push(entry.id);

      const { error: linesError } = await supabase.client.from('journal_lines').insert(
        lines.map((line) => ({
          journal_entry_id: entry.id,
          ...line,
        })),
      );

      if (linesError) {
        throw linesError;
      }

      return { id: entry.id, lines };
    }

    it('returns a journal entry audit lifecycle including insert and reversal records', async () => {
      const draftId = await insertDraftJournalEntry('audit-log lifecycle draft probe');
      const posted = await insertPostedJournalEntry('audit-log lifecycle posted probe');

      const { data: originalPeriod, error: periodError } = await supabase.client
        .from('accounting_periods')
        .select('period_end')
        .eq('company_id', COMPANY_ID)
        .order('period_start', { ascending: true })
        .limit(1)
        .single();

      if (periodError || !originalPeriod) {
        throw periodError ?? new Error('Period not found');
      }

      const nextPeriod = await getNextOpenPeriod(originalPeriod.period_end);
      const reversalNumber = await nextEntryNumber();
      const postedAt = new Date().toISOString();

      const { data: reversalEntry, error: reversalError } = await supabase.client
        .from('journal_entries')
        .insert({
          company_id: COMPANY_ID,
          entry_number: reversalNumber,
          period_id: nextPeriod.id,
          entry_date: nextPeriod.period_start,
          entry_type: JournalEntryType.Reversal,
          status: JournalEntryStatus.Posted,
          narration: `Reversal of audit lifecycle probe ${posted.id}`,
          reverses_entry_id: posted.id,
          created_by: USER_ID,
          posted_at: postedAt,
        })
        .select('id')
        .single();

      if (reversalError || !reversalEntry) {
        throw reversalError ?? new Error('Failed to insert reversal entry');
      }

      createdEntryIds.push(reversalEntry.id);

      const { error: reversalLinesError } = await supabase.client.from('journal_lines').insert(
        posted.lines.map((line) => ({
          journal_entry_id: reversalEntry.id,
          line_number: line.line_number,
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit,
        })),
      );

      if (reversalLinesError) {
        throw reversalLinesError;
      }

      const draftHistory = await service.find({
        company_id: COMPANY_ID,
        record_id: draftId,
        table_name: 'journal_entries',
      });

      expect(draftHistory.length).toBeGreaterThanOrEqual(1);
      expect(draftHistory[0].action).toBe(AuditAction.Insert);
      expect(draftHistory[0].old_data).toBeNull();
      expect(draftHistory[0].new_data?.status).toBe(JournalEntryStatus.Draft);
      expect(draftHistory[0].actor_id).toBe(USER_ID);

      const postedHistory = await service.find({
        company_id: COMPANY_ID,
        record_id: posted.id,
        table_name: 'journal_entries',
      });

      expect(postedHistory.length).toBeGreaterThanOrEqual(1);
      expect(postedHistory[0].action).toBe(AuditAction.Insert);
      expect(postedHistory[0].new_data?.status).toBe(JournalEntryStatus.Posted);

      const reversalHistory = await service.find({
        company_id: COMPANY_ID,
        record_id: reversalEntry.id,
        table_name: 'journal_entries',
      });

      expect(reversalHistory).toHaveLength(1);
      expect(reversalHistory[0].action).toBe(AuditAction.Insert);
      expect(reversalHistory[0].new_data?.entry_type).toBe(JournalEntryType.Reversal);
      expect(reversalHistory[0].new_data?.reverses_entry_id).toBe(posted.id);

      const actorFiltered = await service.find({
        company_id: COMPANY_ID,
        actor_id: USER_ID,
        table_name: 'journal_entries',
        from: '2026-08-22',
        to: '2026-08-22',
      });

      expect(actorFiltered.some((row) => row.record_id === draftId)).toBe(true);
      expect(actorFiltered.some((row) => row.record_id === posted.id)).toBe(true);
      expect(actorFiltered.some((row) => row.record_id === reversalEntry.id)).toBe(true);
    });

    it('blocks UPDATE and DELETE against audit_log via block_audit_log_mutation', async () => {
      const rows = await service.find({
        company_id: COMPANY_ID,
        table_name: 'journal_entries',
      });

      expect(rows.length).toBeGreaterThan(0);
      const target = rows[0];

      const { error: updateError } = await supabase.client
        .from('audit_log')
        .update({ notes: 'attempted mutation' })
        .eq('id', target.id);

      expect(updateError).not.toBeNull();
      expect(updateError?.code).toBe('P0001');
      expect(updateError?.message).toMatch(/immutable/i);
      expect(updateError?.message).toMatch(/UPDATE/i);

      const { error: deleteError } = await supabase.client
        .from('audit_log')
        .delete()
        .eq('id', target.id);

      expect(deleteError).not.toBeNull();
      expect(deleteError?.code).toBe('P0001');
      expect(deleteError?.message).toMatch(/immutable/i);
      expect(deleteError?.message).toMatch(/DELETE/i);

      const stillThere = await service.find({
        company_id: COMPANY_ID,
        record_id: target.record_id,
        table_name: target.table_name,
      });

      expect(stillThere.some((row) => row.id === target.id)).toBe(true);
    });
  },
);
