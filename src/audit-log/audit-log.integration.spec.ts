import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { Test, TestingModule } from '@nestjs/testing';
import { AuditAction } from '../common/enums/audit-action.enum';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { AuditLogModule } from './audit-log.module';
import { AuditLogService } from './audit-log.service';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
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
    let auditLogService: AuditLogService;
    let journalEntriesService: JournalEntriesService;
    let supabase: SupabaseService;
    const createdEntryIds: string[] = [];
    let periodId = '';
    let cashAccountId = '';
    let bankAccountId = '';

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          DatabaseModule,
          AccountingPeriodsModule,
          AuditLogModule,
          JournalEntriesModule,
        ],
      }).compile();

      auditLogService = module.get(AuditLogService);
      journalEntriesService = module.get(JournalEntriesService);
      supabase = module.get(SupabaseService);

      await ensureAuditLogIntegrationCompanyReady(supabase);

      const { data: period, error: periodError } = await supabase.client
        .from('accounting_periods')
        .select('id')
        .eq('company_id', COMPANY_ID)
        .eq('period_start', '2026-01-01')
        .single();

      if (periodError || !period) {
        throw periodError ?? new Error('January 2026 period not found');
      }
      periodId = period.id as string;

      const { data: accounts, error: accountsError } = await supabase.client
        .from('accounts')
        .select('id, account_number')
        .eq('company_id', COMPANY_ID)
        .in('account_number', ['1011', '1020']);

      if (accountsError || !accounts || accounts.length < 2) {
        throw accountsError ?? new Error('Need cash and bank accounts for audit probes');
      }

      for (const account of accounts) {
        if (account.account_number === '1011') {
          cashAccountId = account.id as string;
        } else if (account.account_number === '1020') {
          bankAccountId = account.id as string;
        }
      }
    }, 120000);

    afterAll(async () => {
      for (const entryId of createdEntryIds.reverse()) {
        await supabase.client.from('journal_lines').delete().eq('journal_entry_id', entryId);
        await supabase.client.from('journal_entries').delete().eq('id', entryId);
      }
    });

    it(
      'service-layer post and reverse produce insert, status_change, and reversal audit rows',
      async () => {
        // Draft create → insert audit only
        const draft = await journalEntriesService.create(
          {
            company_id: COMPANY_ID,
            period_id: periodId,
            entry_date: '2026-01-15',
            narration: 'audit-log service-layer draft probe',
            lines: [
              { line_number: 1, account_id: cashAccountId, debit: 125, credit: 0 },
              { line_number: 2, account_id: bankAccountId, debit: 0, credit: 125 },
            ],
          },
          USER_ID,
        );
        createdEntryIds.push(draft.entry.id);

        const draftHistory = await auditLogService.find({
          company_id: COMPANY_ID,
          record_id: draft.entry.id,
          table_name: 'journal_entries',
        });

        expect(draftHistory).toHaveLength(1);
        expect(draftHistory[0].action).toBe(AuditAction.Insert);
        expect(draftHistory[0].old_data).toBeNull();
        expect(draftHistory[0].new_data?.status).toBe(JournalEntryStatus.Draft);
        expect(draftHistory[0].actor_id).toBe(USER_ID);

        // Real postEntry() path → status_change (draft → posted)
        const posted = await journalEntriesService.post(draft.entry.id, USER_ID);
        expect(posted.entry.status).toBe(JournalEntryStatus.Posted);

        const postedHistory = await auditLogService.find({
          company_id: COMPANY_ID,
          record_id: draft.entry.id,
          table_name: 'journal_entries',
        });

        expect(postedHistory.some((row) => row.action === AuditAction.Insert)).toBe(true);

        const statusChange = postedHistory.find(
          (row) => row.action === AuditAction.StatusChange,
        );
        expect(statusChange).toBeDefined();
        expect(statusChange?.old_data?.status).toBe(JournalEntryStatus.Draft);
        expect(statusChange?.new_data?.status).toBe(JournalEntryStatus.Posted);
        expect(statusChange?.actor_id).toBe(USER_ID);

        // Real reverseEntry() path — schema.log_journal_entry_change:
        //   • reversing entry INSERT → action = insert (distinct record_id)
        //   • original UPDATE to reversed → action = reversal (distinct row on original)
        const reversal = await journalEntriesService.reverse(draft.entry.id, USER_ID);
        createdEntryIds.push(reversal.reversal.entry.id);

        expect(reversal.original.entry.status).toBe(JournalEntryStatus.Reversed);
        expect(reversal.original.entry.reversed_by_entry_id).toBe(reversal.reversal.entry.id);
        expect(reversal.reversal.entry.entry_type).toBe(JournalEntryType.Reversal);
        expect(reversal.reversal.entry.reverses_entry_id).toBe(draft.entry.id);

        const reversalEntryHistory = await auditLogService.find({
          company_id: COMPANY_ID,
          record_id: reversal.reversal.entry.id,
          table_name: 'journal_entries',
        });

        expect(reversalEntryHistory.length).toBeGreaterThanOrEqual(2);
        const reversalInsert = reversalEntryHistory.find(
          (row) => row.action === AuditAction.Insert,
        );
        expect(reversalInsert).toBeDefined();
        expect(reversalInsert?.new_data?.entry_type).toBe(JournalEntryType.Reversal);
        expect(reversalInsert?.new_data?.status).toBe(JournalEntryStatus.Draft);
        expect(reversalInsert?.new_data?.reverses_entry_id).toBe(draft.entry.id);

        const reversalPost = reversalEntryHistory.find(
          (row) =>
            row.action === AuditAction.StatusChange &&
            row.old_data?.status === JournalEntryStatus.Draft &&
            row.new_data?.status === JournalEntryStatus.Posted,
        );
        expect(reversalPost).toBeDefined();
        expect(reversalPost?.new_data?.entry_type).toBe(JournalEntryType.Reversal);

        const originalHistory = await auditLogService.find({
          company_id: COMPANY_ID,
          record_id: draft.entry.id,
          table_name: 'journal_entries',
        });

        const reversalAudit = originalHistory.find(
          (row) => row.action === AuditAction.Reversal,
        );
        expect(reversalAudit).toBeDefined();
        expect(reversalAudit?.old_data?.status).toBe(JournalEntryStatus.Posted);
        expect(reversalAudit?.new_data?.status).toBe(JournalEntryStatus.Reversed);
        expect(reversalAudit?.new_data?.reversed_by_entry_id).toBe(
          reversal.reversal.entry.id,
        );

        // Distinct rows: insert(+status_change) on reversing entry, reversal on original
        expect(reversalInsert?.id).not.toBe(reversalAudit?.id);
        expect(reversalInsert?.record_id).toBe(reversal.reversal.entry.id);
        expect(reversalAudit?.record_id).toBe(draft.entry.id);

        // Lifecycle on original: insert + status_change + reversal (three distinct actions)
        expect(originalHistory.some((row) => row.action === AuditAction.Insert)).toBe(true);
        expect(originalHistory.some((row) => row.action === AuditAction.StatusChange)).toBe(
          true,
        );
        expect(originalHistory.some((row) => row.action === AuditAction.Reversal)).toBe(true);

        const actorFiltered = await auditLogService.find({
          company_id: COMPANY_ID,
          actor_id: USER_ID,
          table_name: 'journal_entries',
        });

        expect(actorFiltered.some((row) => row.record_id === draft.entry.id)).toBe(true);
        expect(
          actorFiltered.some((row) => row.record_id === reversal.reversal.entry.id),
        ).toBe(true);
      },
      30000,
    );

    it('blocks UPDATE and DELETE against audit_log via block_audit_log_mutation', async () => {
      const rows = await auditLogService.find({
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

      const stillThere = await auditLogService.find({
        company_id: COMPANY_ID,
        record_id: target.record_id,
        table_name: target.table_name,
      });

      expect(stillThere.some((row) => row.id === target.id)).toBe(true);
    });
  },
);
