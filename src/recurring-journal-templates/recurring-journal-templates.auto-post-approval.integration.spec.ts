import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RecurrenceFrequency } from '../common/enums/recurrence-frequency.enum';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { CompanyMembersModule } from '../company-members/company-members.module';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import { APPROVAL_THRESHOLD } from '../e2e/e2e-company.setup';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import {
  INTEGRATION_ACCOUNTANT_ID,
  INTEGRATION_USER_ID,
  mintFreshIntegrationCompany,
} from '../test/integration-company.setup';
import { RecurringJournalTemplatesModule } from './recurring-journal-templates.module';
import { RecurringJournalTemplatesService } from './recurring-journal-templates.service';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const OWNER_ID = INTEGRATION_USER_ID;
const ACCOUNTANT_ID = INTEGRATION_ACCOUNTANT_ID;
const RUN_DATE = '2026-01-31';

(hasSupabase ? describe : describe.skip)(
  'Recurring template auto_post approval (Supabase integration)',
  () => {
    jest.setTimeout(180_000);

    let recurringService: RecurringJournalTemplatesService;
    let journalEntriesService: JournalEntriesService;
    let supabase: SupabaseService;
    let companyId = '';
    let expenseAccountId = '';
    let cashAccountId = '';
    const createdEntryIds: string[] = [];
    const createdTemplateIds: string[] = [];

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          DatabaseModule,
          AccountingPeriodsModule,
          CompanyMembersModule,
          JournalEntriesModule,
          RecurringJournalTemplatesModule,
        ],
      }).compile();

      recurringService = module.get(RecurringJournalTemplatesService);
      journalEntriesService = module.get(JournalEntriesService);
      supabase = module.get(SupabaseService);

      companyId = await mintFreshIntegrationCompany(supabase, 'Recurring Auto-Post Approval', {
        withAccountant: true,
      });

      const { data: accounts, error: accountsError } = await supabase.client
        .from('accounts')
        .select('id, account_number')
        .eq('company_id', companyId)
        .in('account_number', ['1010', '5100']);

      if (accountsError || !accounts || accounts.length < 2) {
        throw accountsError ?? new Error('Need cash and expense accounts');
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
      for (const templateId of createdTemplateIds.reverse()) {
        await supabase.client
          .from('recurring_journal_template_lines')
          .delete()
          .eq('template_id', templateId);
        await supabase.client
          .from('recurring_journal_templates')
          .delete()
          .eq('id', templateId);
      }
    });

    async function createAutoPostTemplate(
      createdBy: string,
      amount: number,
      autoPost: boolean,
    ): Promise<string> {
      const created = await recurringService.create(
        {
          company_id: companyId,
          template_name: `Auto-post probe ${amount}`,
          narration_template: 'Recurring auto-post approval probe',
          frequency: RecurrenceFrequency.Monthly,
          start_date: '2026-01-01',
          next_run_date: RUN_DATE,
          day_of_month: 31,
          auto_post: autoPost,
          lines: [
            {
              line_number: 1,
              account_id: expenseAccountId,
              debit: amount,
              credit: 0,
            },
            {
              line_number: 2,
              account_id: cashAccountId,
              debit: 0,
              credit: amount,
            },
          ],
        },
        createdBy,
      );
      createdTemplateIds.push(created.template.id);
      return created.template.id;
    }

    it('auto_post=true below approval threshold posts automatically', async () => {
      const templateId = await createAutoPostTemplate(
        ACCOUNTANT_ID,
        APPROVAL_THRESHOLD - 1,
        true,
      );

      const result = await recurringService.generateTemplate(templateId, RUN_DATE);

      expect(result.posted).toBe(true);
      expect(result.journal_entry?.entry.status).toBe(JournalEntryStatus.Posted);
      if (result.journal_entry) {
        createdEntryIds.push(result.journal_entry.entry.id);
      }
    });

    it('auto_post=true at approval threshold for non-Owner requires approval workflow', async () => {
      const templateId = await createAutoPostTemplate(
        ACCOUNTANT_ID,
        APPROVAL_THRESHOLD,
        true,
      );

      const result = await recurringService.generateTemplate(templateId, RUN_DATE);

      expect(result.posted).toBe(false);
      expect(result.journal_entry?.entry.status).toBe(JournalEntryStatus.PendingApproval);
      expect(result.error).toMatch(/approval threshold/i);
      expect(result.next_run_date).toBe('2026-02-28');

      const entryId = result.journal_entry!.entry.id;
      createdEntryIds.push(entryId);

      await expect(journalEntriesService.approve(entryId, ACCOUNTANT_ID)).rejects.toThrow(
        ForbiddenException,
      );

      const approved = await journalEntriesService.approve(entryId, OWNER_ID);
      expect(approved.entry.status).toBe(JournalEntryStatus.Posted);
    });

    it('auto_post=false leaves draft unposted', async () => {
      const templateId = await createAutoPostTemplate(
        ACCOUNTANT_ID,
        100,
        false,
      );

      const result = await recurringService.generateTemplate(templateId, RUN_DATE);

      expect(result.posted).toBe(false);
      expect(result.journal_entry?.entry.status).toBe(JournalEntryStatus.Draft);
      if (result.journal_entry) {
        createdEntryIds.push(result.journal_entry.entry.id);
      }
    });

    it('re-running after pending approval does not duplicate the same period entry', async () => {
      const templateId = await createAutoPostTemplate(
        ACCOUNTANT_ID,
        APPROVAL_THRESHOLD,
        true,
      );

      const first = await recurringService.generateTemplate(templateId, RUN_DATE);
      expect(first.journal_entry?.entry.status).toBe(JournalEntryStatus.PendingApproval);
      createdEntryIds.push(first.journal_entry!.entry.id);

      const { data: janEntries, error: janError } = await supabase.client
        .from('journal_entries')
        .select('id')
        .eq('company_id', companyId)
        .eq('recurring_template_id', templateId)
        .eq('entry_date', RUN_DATE);

      expect(janError).toBeNull();
      expect(janEntries).toHaveLength(1);

      const second = await recurringService.generateTemplate(templateId, '2026-02-28');
      expect(second.journal_entry?.entry.entry_date).toBe('2026-02-28');
      if (second.journal_entry) {
        createdEntryIds.push(second.journal_entry.entry.id);
      }

      const { data: allEntries, error: allError } = await supabase.client
        .from('journal_entries')
        .select('id, entry_date, status')
        .eq('company_id', companyId)
        .eq('recurring_template_id', templateId)
        .order('entry_date');

      expect(allError).toBeNull();
      expect(allEntries).toHaveLength(2);
      expect(allEntries?.[0].entry_date).toBe(RUN_DATE);
      expect(allEntries?.[0].status).toBe(JournalEntryStatus.PendingApproval);
    });

    it('auto_post=true above threshold posts when template creator is Owner', async () => {
      const templateId = await createAutoPostTemplate(
        OWNER_ID,
        APPROVAL_THRESHOLD,
        true,
      );

      const result = await recurringService.generateTemplate(templateId, RUN_DATE);

      expect(result.posted).toBe(true);
      expect(result.journal_entry?.entry.status).toBe(JournalEntryStatus.Posted);
      if (result.journal_entry) {
        createdEntryIds.push(result.journal_entry.entry.id);
      }
    });
  },
);
