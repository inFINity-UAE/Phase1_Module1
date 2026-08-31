import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { Test, TestingModule } from '@nestjs/testing';
import { RecurrenceFrequency } from '../common/enums/recurrence-frequency.enum';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { CompanyMembersModule } from '../company-members/company-members.module';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import {
  GenerateDueRecurringEntryResult,
  JOURNAL_ENTRIES_REPOSITORY,
  JournalEntriesRepository,
} from '../journal-entries/journal-entries.repository';
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
const RUN_DATE = '2026-01-31';
const CONCURRENCY = 8;

(hasSupabase ? describe : describe.skip)(
  'Recurring due generation concurrency (decision #63)',
  () => {
    jest.setTimeout(180_000);

    let recurringService: RecurringJournalTemplatesService;
    let schedulerService: RecurringJournalSchedulerService;
    let journalRepo: JournalEntriesRepository;
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
      schedulerService = module.get(RecurringJournalSchedulerService);
      journalRepo = module.get(JOURNAL_ENTRIES_REPOSITORY);
      supabase = module.get(SupabaseService);

      companyId = await mintFreshIntegrationCompany(
        supabase,
        'Recurring Concurrency #63',
      );

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

    async function createDueTemplate(
      name: string,
      amount: number,
    ): Promise<string> {
      const created = await recurringService.create(
        {
          company_id: companyId,
          template_name: name,
          narration_template: `Concurrency probe ${name}`,
          frequency: RecurrenceFrequency.Monthly,
          start_date: '2026-01-01',
          next_run_date: RUN_DATE,
          day_of_month: 31,
          auto_post: false,
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
        OWNER_ID,
      );
      createdTemplateIds.push(created.template.id);
      return created.template.id;
    }

    async function countEntriesForTemplate(templateId: string): Promise<number> {
      const { data, error } = await supabase.client
        .from('journal_entries')
        .select('id')
        .eq('recurring_template_id', templateId);
      if (error) {
        throw error;
      }
      for (const row of data ?? []) {
        createdEntryIds.push(row.id as string);
      }
      return (data ?? []).length;
    }

    async function readNextRunDate(templateId: string): Promise<string> {
      const { data, error } = await supabase.client
        .from('recurring_journal_templates')
        .select('next_run_date')
        .eq('id', templateId)
        .single();
      if (error || !data) {
        throw error ?? new Error('template missing');
      }
      return String(data.next_run_date);
    }

    it('N concurrent generateTemplate calls for the SAME template produce exactly one journal entry', async () => {
      const templateId = await createDueTemplate('Same-template race', 100);

      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          recurringService.generateTemplate(templateId, RUN_DATE),
        ),
      );

      const generated = results.filter((r) => r.journal_entry != null);
      const skipped = results.filter((r) => r.journal_entry == null);

      expect(generated).toHaveLength(1);
      expect(skipped).toHaveLength(CONCURRENCY - 1);
      expect(await countEntriesForTemplate(templateId)).toBe(1);
      expect(await readNextRunDate(templateId)).toBe('2026-02-28');
      expect(new Set(results.map((r) => r.next_run_date))).toEqual(
        new Set(['2026-02-28']),
      );
    });

    it('concurrent generation for TWO DIFFERENT templates both succeed (per-template lock)', async () => {
      const templateA = await createDueTemplate('Diff-template A', 110);
      const templateB = await createDueTemplate('Diff-template B', 120);

      const [resultsA, resultsB] = await Promise.all([
        Promise.all(
          Array.from({ length: 4 }, () =>
            recurringService.generateTemplate(templateA, RUN_DATE),
          ),
        ),
        Promise.all(
          Array.from({ length: 4 }, () =>
            recurringService.generateTemplate(templateB, RUN_DATE),
          ),
        ),
      ]);

      expect(resultsA.filter((r) => r.journal_entry != null)).toHaveLength(1);
      expect(resultsB.filter((r) => r.journal_entry != null)).toHaveLength(1);
      expect(await countEntriesForTemplate(templateA)).toBe(1);
      expect(await countEntriesForTemplate(templateB)).toBe(1);
      expect(await readNextRunDate(templateA)).toBe('2026-02-28');
      expect(await readNextRunDate(templateB)).toBe('2026-02-28');
    });

    it('cron-path and manual run-due racing for the same template produce one entry', async () => {
      const templateId = await createDueTemplate('Cron-vs-manual race', 130);

      const [manualResults, cronSummary] = await Promise.all([
        recurringService.runDueGenerations(companyId, RUN_DATE),
        schedulerService.runScheduledDueGenerations(RUN_DATE),
      ]);

      const fromManual = manualResults.filter(
        (r) => r.template_id === templateId && r.journal_entry != null,
      );
      const fromCron = cronSummary.results.filter(
        (r) => r.template_id === templateId && r.journal_entry != null,
      );

      expect(fromManual.length + fromCron.length).toBe(1);
      expect(await countEntriesForTemplate(templateId)).toBe(1);
      expect(await readNextRunDate(templateId)).toBe('2026-02-28');
    });

    it('auto_post balance failure deletes the draft, reverts next_run_date, and re-dues on retry', async () => {
      // [feature-spec.md decision #63] RPC advances schedule before Nest #52 post;
      // balance rejection must not leave an orphan draft or a permanently-advanced schedule.
      const created = await recurringService.create(
        {
          company_id: companyId,
          template_name: 'Post-fail revert probe',
          narration_template: 'Unbalanced then fixed',
          frequency: RecurrenceFrequency.Monthly,
          start_date: '2026-01-01',
          next_run_date: RUN_DATE,
          day_of_month: 31,
          auto_post: true,
          lines: [
            {
              line_number: 1,
              account_id: expenseAccountId,
              debit: 100,
              credit: 0,
            },
            {
              line_number: 2,
              account_id: cashAccountId,
              debit: 0,
              credit: 50,
            },
          ],
        },
        OWNER_ID,
      );
      const templateId = created.template.id;
      const creditLineId = created.lines.find((l) => l.line_number === 2)!.id;
      createdTemplateIds.push(templateId);

      let nextRunAfterClaim: string | null = null;
      let entryIdAfterClaim: string | null = null;
      const originalClaim = journalRepo.generateDueRecurringEntry.bind(journalRepo);
      const claimSpy = jest
        .spyOn(journalRepo, 'generateDueRecurringEntry')
        .mockImplementation(async (id: string, asOf: string) => {
          const claim: GenerateDueRecurringEntryResult = await originalClaim(id, asOf);
          if (!claim.skipped) {
            entryIdAfterClaim = claim.journal.entry.id;
            nextRunAfterClaim = await readNextRunDate(templateId);
          }
          return claim;
        });

      try {
        const failed = await recurringService.generateTemplate(templateId, RUN_DATE);

        expect(nextRunAfterClaim).toBe('2026-02-28');
        expect(entryIdAfterClaim).toBeTruthy();
        expect(failed.journal_entry).toBeNull();
        expect(failed.posted).toBe(false);
        expect(failed.error).toMatch(/must equal total credits/i);
        expect(failed.next_run_date).toBe(RUN_DATE);

        // (a) orphaned draft deleted
        const { data: leftover, error: leftoverError } = await supabase.client
          .from('journal_entries')
          .select('id')
          .eq('id', entryIdAfterClaim!);
        if (leftoverError) {
          throw leftoverError;
        }
        expect(leftover ?? []).toHaveLength(0);
        expect(await countEntriesForTemplate(templateId)).toBe(0);

        // (b) schedule genuinely back to pre-generation value
        expect(await readNextRunDate(templateId)).toBe(RUN_DATE);

        // Fix balance so the due cycle can succeed.
        await recurringService.updateLine(creditLineId, { credit: 100 });

        // (c) next run picks the template back up as due
        const recovered = await recurringService.generateTemplate(templateId, RUN_DATE);
        expect(recovered.journal_entry).not.toBeNull();
        expect(recovered.posted).toBe(true);
        expect(recovered.next_run_date).toBe('2026-02-28');
        if (recovered.journal_entry) {
          createdEntryIds.push(recovered.journal_entry.entry.id);
        }
        expect(await countEntriesForTemplate(templateId)).toBe(1);
        expect(await readNextRunDate(templateId)).toBe('2026-02-28');
      } finally {
        claimSpy.mockRestore();
      }
    });
  },
);
