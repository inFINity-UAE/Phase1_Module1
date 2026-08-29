import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditAction } from '../common/enums/audit-action.enum';
import { CompanyRole } from '../common/enums/company-role.enum';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CompanyMembersModule } from '../company-members/company-members.module';
import { CompanyMembersService } from '../company-members/company-members.service';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import { APPROVAL_THRESHOLD } from '../e2e/e2e-company.setup';
import { JournalEntriesModule } from './journal-entries.module';
import { JournalEntriesService } from './journal-entries.service';
import {
  ensureApprovalRbacIntegrationCompanyReady,
  INTEGRATION_ACCOUNTANT_ID,
  INTEGRATION_USER_ID,
} from '../test/integration-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const OWNER_ID = INTEGRATION_USER_ID;
const ACCOUNTANT_ID = INTEGRATION_ACCOUNTANT_ID;
const SELF_APPROVED_NOTE = 'Self-approved by Owner';

(hasSupabase ? describe : describe.skip)(
  'Journal entry approval RBAC (Supabase integration)',
  () => {
    // Match Stage 13 / advisory-lock: COA clone + live RPCs exceed Jest's 5s default.
    jest.setTimeout(180_000);

    let service: JournalEntriesService;
    let auditLogService: AuditLogService;
    let companyMembersService: CompanyMembersService;
    let supabase: SupabaseService;
    /** [feature-spec.md decision #19] Fresh company UUID per run. */
    let companyId = '';
    const createdEntryIds: string[] = [];
    let periodId = '';
    let expenseAccountId = '';
    let cashAccountId = '';

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          DatabaseModule,
          AccountingPeriodsModule,
          CompanyMembersModule,
          JournalEntriesModule,
          AuditLogModule,
        ],
      }).compile();

      service = module.get(JournalEntriesService);
      auditLogService = module.get(AuditLogService);
      companyMembersService = module.get(CompanyMembersService);
      supabase = module.get(SupabaseService);

      companyId = await ensureApprovalRbacIntegrationCompanyReady(supabase);

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
        .in('account_number', ['1010', '5100']);

      if (accountsError || !accounts || accounts.length < 2) {
        throw accountsError ?? new Error('Need cash and expense accounts for RBAC probe');
      }

      for (const account of accounts) {
        if (account.account_number === '1010') {
          cashAccountId = account.id as string;
        }
        if (account.account_number === '5100') {
          expenseAccountId = account.id as string;
        }
      }
    }, 120000);

    afterAll(async () => {
      for (const entryId of createdEntryIds.reverse()) {
        await supabase.client.from('journal_lines').delete().eq('journal_entry_id', entryId);
        await supabase.client.from('journal_entries').delete().eq('id', entryId);
      }
    });

    async function createPendingApprovalEntry(
      createdBy: string = ACCOUNTANT_ID,
    ): Promise<string> {
      const draft = await service.create(
        {
          company_id: companyId,
          period_id: periodId,
          entry_date: '2026-01-20',
          narration: 'RBAC approval probe',
          lines: [
            {
              line_number: 1,
              account_id: expenseAccountId,
              debit: APPROVAL_THRESHOLD,
              credit: 0,
            },
            {
              line_number: 2,
              account_id: cashAccountId,
              debit: 0,
              credit: APPROVAL_THRESHOLD,
            },
          ],
        },
        createdBy,
      );
      createdEntryIds.push(draft.entry.id);

      // Non-Owner post submits above-threshold drafts for approval (even if Owner created).
      const pending = await service.post(draft.entry.id, ACCOUNTANT_ID);
      expect(pending.entry.status).toBe(JournalEntryStatus.PendingApproval);
      return draft.entry.id;
    }

    it('resolves accountant role from company_members — not a spoofed owner body claim', async () => {
      const entryId = await createPendingApprovalEntry();

      const resolved = await companyMembersService.resolveRoleForJournalEntry(
        ACCOUNTANT_ID,
        entryId,
      );
      expect(resolved.role).toBe(CompanyRole.Accountant);

      await expect(service.approve(entryId, ACCOUNTANT_ID)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.approve(entryId, ACCOUNTANT_ID)).rejects.toThrow(
        /Only an Owner or Manager can approve/);
    });

    it('rejects reject when DB membership role is accountant (403 even if client sent actor_role owner)', async () => {
      const entryId = await createPendingApprovalEntry();

      await expect(
        service.reject(entryId, ACCOUNTANT_ID, {
          rejection_reason: 'Spoofed owner reject attempt',
        }),
      ).rejects.toThrow(/Only an Owner or Manager can reject/);
    });

    it('allows Owner to approve after accountant submission', async () => {
      const entryId = await createPendingApprovalEntry();

      const approved = await service.approve(entryId, OWNER_ID);
      expect(approved.entry.status).toBe(JournalEntryStatus.Posted);
      expect(approved.entry.approved_by).toBe(OWNER_ID);
    });

    it('Owner approving someone else leaves status_change notes unlabeled (#55)', async () => {
      const entryId = await createPendingApprovalEntry(ACCOUNTANT_ID);
      await service.approve(entryId, OWNER_ID);

      const rows = await auditLogService.find({
        company_id: companyId,
        record_id: entryId,
        table_name: 'journal_entries',
      });
      const statusChanges = rows.filter((r) => r.action === AuditAction.StatusChange);
      expect(statusChanges.length).toBeGreaterThan(0);
      expect(statusChanges.some((r) => r.notes === SELF_APPROVED_NOTE)).toBe(false);
    });

    it('Owner self-approval writes notes = Self-approved by Owner (#55)', async () => {
      // Owner-created draft; Accountant submits above threshold → pending;
      // Owner approve → approved_by = created_by → trigger labels.
      const entryId = await createPendingApprovalEntry(OWNER_ID);
      const approved = await service.approve(entryId, OWNER_ID);
      expect(approved.entry.approved_by).toBe(OWNER_ID);
      expect(approved.entry.created_by).toBe(OWNER_ID);

      const rows = await auditLogService.find({
        company_id: companyId,
        record_id: entryId,
        table_name: 'journal_entries',
      });
      const labeled = rows.filter(
        (r) => r.action === AuditAction.StatusChange && r.notes === SELF_APPROVED_NOTE,
      );
      expect(labeled).toHaveLength(1);
      expect(labeled[0].actor_id).toBe(OWNER_ID);
    });

    it('Owner posting their own draft stamps self-approval audit notes (#55)', async () => {
      const draft = await service.create(
        {
          company_id: companyId,
          period_id: periodId,
          entry_date: '2026-01-21',
          narration: 'Owner self-post audit probe',
          lines: [
            {
              line_number: 1,
              account_id: expenseAccountId,
              debit: APPROVAL_THRESHOLD,
              credit: 0,
            },
            {
              line_number: 2,
              account_id: cashAccountId,
              debit: 0,
              credit: APPROVAL_THRESHOLD,
            },
          ],
        },
        OWNER_ID,
      );
      createdEntryIds.push(draft.entry.id);

      const posted = await service.post(draft.entry.id, OWNER_ID);
      expect(posted.entry.status).toBe(JournalEntryStatus.Posted);
      expect(posted.entry.approved_by).toBe(OWNER_ID);

      const rows = await auditLogService.find({
        company_id: companyId,
        record_id: draft.entry.id,
        table_name: 'journal_entries',
      });
      expect(
        rows.some(
          (r) => r.action === AuditAction.StatusChange && r.notes === SELF_APPROVED_NOTE,
        ),
      ).toBe(true);
    });
  },
);
