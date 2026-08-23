import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CompanyRole } from '../common/enums/company-role.enum';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { CompanyMembersModule } from '../company-members/company-members.module';
import { CompanyMembersService } from '../company-members/company-members.service';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import { APPROVAL_THRESHOLD } from '../e2e/e2e-company.setup';
import { JournalEntriesModule } from './journal-entries.module';
import { JournalEntriesService } from './journal-entries.service';
import {
  APPROVAL_RBAC_INTEGRATION_COMPANY_ID,
  ensureApprovalRbacIntegrationCompanyReady,
  INTEGRATION_ACCOUNTANT_ID,
  INTEGRATION_USER_ID,
} from '../test/integration-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const COMPANY_ID = APPROVAL_RBAC_INTEGRATION_COMPANY_ID;
const OWNER_ID = INTEGRATION_USER_ID;
const ACCOUNTANT_ID = INTEGRATION_ACCOUNTANT_ID;

(hasSupabase ? describe : describe.skip)(
  'Journal entry approval RBAC (Supabase integration)',
  () => {
    let service: JournalEntriesService;
    let companyMembersService: CompanyMembersService;
    let supabase: SupabaseService;
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
        ],
      }).compile();

      service = module.get(JournalEntriesService);
      companyMembersService = module.get(CompanyMembersService);
      supabase = module.get(SupabaseService);

      await ensureApprovalRbacIntegrationCompanyReady(supabase);

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
        .in('account_number', ['1011', '5010']);

      if (accountsError || !accounts || accounts.length < 2) {
        throw accountsError ?? new Error('Need cash and expense accounts for RBAC probe');
      }

      for (const account of accounts) {
        if (account.account_number === '1011') {
          cashAccountId = account.id as string;
        }
        if (account.account_number === '5010') {
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

    async function createPendingApprovalEntry(): Promise<string> {
      const draft = await service.create(
        {
          company_id: COMPANY_ID,
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
        ACCOUNTANT_ID,
      );
      createdEntryIds.push(draft.entry.id);

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

      // Service resolves role from DB via user id; actor_role is no longer accepted in the body.
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
  },
);
