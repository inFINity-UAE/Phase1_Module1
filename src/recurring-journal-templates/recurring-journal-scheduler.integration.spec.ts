import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { Test, TestingModule } from '@nestjs/testing';
import { RecurrenceFrequency } from '../common/enums/recurrence-frequency.enum';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { CompanyMembersModule } from '../company-members/company-members.module';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import {
  INTEGRATION_USER_ID,
  mintFreshIntegrationCompany,
} from '../test/integration-company.setup';
import { RecurringJournalSchedulerService } from './recurring-journal-scheduler.service';
import { RecurringJournalTemplatesModule } from './recurring-journal-templates.module';
import { RecurringJournalTemplatesService } from './recurring-journal-templates.service';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const OWNER_ID = INTEGRATION_USER_ID;
const AS_OF = '2026-01-31';

/**
 * [feature-spec.md decision #62] Proves unattended schedule path —
 * invokes RecurringJournalSchedulerService.runScheduledDueGenerations
 * (the cron handler body), NOT generateTemplate / POST run-due.
 */
(hasSupabase ? describe : describe.skip)(
  'Recurring journal scheduler (decision #62)',
  () => {
    jest.setTimeout(300_000);

    let scheduler: RecurringJournalSchedulerService;
    let recurringService: RecurringJournalTemplatesService;
    let supabase: SupabaseService;
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

      scheduler = module.get(RecurringJournalSchedulerService);
      recurringService = module.get(RecurringJournalTemplatesService);
      supabase = module.get(SupabaseService);
    }, 120_000);

    afterAll(async () => {
      for (const entryId of createdEntryIds.reverse()) {
        await supabase.client
          .from('journal_lines')
          .delete()
          .eq('journal_entry_id', entryId);
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

    async function accountIds(
      companyId: string,
    ): Promise<{ cashId: string; expenseId: string }> {
      const { data, error } = await supabase.client
        .from('accounts')
        .select('id, account_number')
        .eq('company_id', companyId)
        .in('account_number', ['1010', '5100']);
      if (error || !data || data.length < 2) {
        throw error ?? new Error('need cash + expense');
      }
      let cashId = '';
      let expenseId = '';
      for (const a of data) {
        if (a.account_number === '1010') cashId = a.id as string;
        if (a.account_number === '5100') expenseId = a.id as string;
      }
      return { cashId, expenseId };
    }

    async function createTemplate(opts: {
      companyId: string;
      name: string;
      nextRunDate: string;
      autoPost?: boolean;
    }): Promise<string> {
      const { cashId, expenseId } = await accountIds(opts.companyId);
      const created = await recurringService.create(
        {
          company_id: opts.companyId,
          template_name: opts.name,
          narration_template: opts.name,
          frequency: RecurrenceFrequency.Monthly,
          start_date: '2026-01-01',
          next_run_date: opts.nextRunDate,
          day_of_month: 31,
          auto_post: opts.autoPost ?? true,
          lines: [
            {
              line_number: 1,
              account_id: expenseId,
              debit: 100,
              credit: 0,
            },
            {
              line_number: 2,
              account_id: cashId,
              debit: 0,
              credit: 100,
            },
          ],
        },
        OWNER_ID,
      );
      createdTemplateIds.push(created.template.id);
      return created.template.id;
    }

    it('scheduled run generates a due template without calling generate/run-due', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 sched due',
      );
      const templateId = await createTemplate({
        companyId,
        name: 'Scheduler due probe',
        nextRunDate: AS_OF,
        autoPost: true,
      });

      // Cron path only — not generateTemplate / HTTP run-due.
      const summary = await scheduler.runScheduledDueGenerations(AS_OF);

      const mine = summary.results.filter((r) => r.template_id === templateId);
      expect(mine).toHaveLength(1);
      expect(mine[0].journal_entry).not.toBeNull();
      expect(mine[0].posted).toBe(true);
      expect(mine[0].journal_entry!.entry.status).toBe(JournalEntryStatus.Posted);
      createdEntryIds.push(mine[0].journal_entry!.entry.id);

      const { data: fromDb } = await supabase.client
        .from('journal_entries')
        .select('id, recurring_template_id, status')
        .eq('recurring_template_id', templateId);
      expect(fromDb?.length).toBeGreaterThanOrEqual(1);
    });

    it('multi-company: both due templates generate in one scheduled run', async () => {
      const companyA = await mintFreshIntegrationCompany(
        supabase,
        'H1 sched co A',
      );
      const companyB = await mintFreshIntegrationCompany(
        supabase,
        'H1 sched co B',
      );
      const templateA = await createTemplate({
        companyId: companyA,
        name: 'Scheduler multi A',
        nextRunDate: AS_OF,
      });
      const templateB = await createTemplate({
        companyId: companyB,
        name: 'Scheduler multi B',
        nextRunDate: AS_OF,
      });

      const summary = await scheduler.runScheduledDueGenerations(AS_OF);

      const a = summary.results.find((r) => r.template_id === templateA);
      const b = summary.results.find((r) => r.template_id === templateB);
      expect(a?.journal_entry).toBeDefined();
      expect(b?.journal_entry).toBeDefined();
      createdEntryIds.push(a!.journal_entry!.entry.id, b!.journal_entry!.entry.id);
    });

    it('one company failure does not starve another company due template', async () => {
      const companyOk = await mintFreshIntegrationCompany(
        supabase,
        'H1 sched ok',
      );
      const companyBad = await mintFreshIntegrationCompany(
        supabase,
        'H1 sched bad',
      );
      const okTemplate = await createTemplate({
        companyId: companyOk,
        name: 'Scheduler isolation ok',
        nextRunDate: AS_OF,
      });
      // Ensure bad company is in the active-template company list.
      const badTpl = await createTemplate({
        companyId: companyBad,
        name: 'Scheduler isolation bad',
        nextRunDate: AS_OF,
      });
      void badTpl;

      const realRun = recurringService.runDueGenerations.bind(recurringService);
      const spy = jest
        .spyOn(recurringService, 'runDueGenerations')
        .mockImplementation(async (companyId, asOf) => {
          if (companyId === companyBad) {
            throw new Error('forced company failure for isolation test');
          }
          return realRun(companyId, asOf);
        });

      try {
        const summary = await scheduler.runScheduledDueGenerations(AS_OF);

        expect(
          summary.company_failures.some((f) => f.company_id === companyBad),
        ).toBe(true);

        const ok = summary.results.find((r) => r.template_id === okTemplate);
        expect(ok?.journal_entry).toBeDefined();
        createdEntryIds.push(ok!.journal_entry!.entry.id);
      } finally {
        spy.mockRestore();
      }
    });

    it('future next_run_date is skipped by the scheduled run', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'H1 sched future',
      );
      const templateId = await createTemplate({
        companyId,
        name: 'Scheduler future skip',
        nextRunDate: '2026-06-30',
      });

      const summary = await scheduler.runScheduledDueGenerations(AS_OF);

      const mine = summary.results.filter((r) => r.template_id === templateId);
      // findDueTemplates filters lte next_run_date — future templates never appear.
      expect(mine).toHaveLength(0);

      const { data: entries } = await supabase.client
        .from('journal_entries')
        .select('id')
        .eq('recurring_template_id', templateId);
      expect(entries ?? []).toHaveLength(0);
    });
  },
);
