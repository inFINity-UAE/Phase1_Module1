import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InvoicesSchedulerService } from '../invoices/invoices-scheduler.service';
import { QuotationsSchedulerService } from '../quotations/quotations-scheduler.service';
import { RecurringGenerationResult } from './entities/recurring-generation-result.entity';
import { RecurringJournalTemplatesService } from './recurring-journal-templates.service';
import {
  RECURRING_JOURNAL_TEMPLATES_REPOSITORY,
  RecurringJournalTemplatesRepository,
} from './recurring-journal-templates.repository';

export type ScheduledRecurringRunSummary = {
  as_of_date: string;
  companies_evaluated: number;
  templates_evaluated: number;
  entries_generated: number;
  company_failures: Array<{ company_id: string; error: string }>;
  results: RecurringGenerationResult[];
};

/**
 * [feature-spec.md decision #62] Unattended daily trigger for due recurring
 * templates, [feature-spec-1.1.C.md §8 decision #20] quotation expiration,
 * and [decision #21] invoice overdue marking. Calls existing runDueGenerations
 * per company — does not replace POST /run-due or POST /generate.
 *
 * Interval: once daily (01:00 UTC). Recurring recurrence_frequency enum is
 * daily/weekly/monthly/quarterly/annually — none require sub-daily runs;
 * a daily sweep catches every due next_run_date. Quotation expiration runs
 * immediately after recurring; invoice overdue marking runs immediately after
 * quotation expiration in the same cron handler (same 01:00 UTC slot).
 */
@Injectable()
export class RecurringJournalSchedulerService {
  private readonly logger = new Logger(RecurringJournalSchedulerService.name);

  constructor(
    private readonly templatesService: RecurringJournalTemplatesService,
    @Inject(RECURRING_JOURNAL_TEMPLATES_REPOSITORY)
    private readonly templatesRepository: RecurringJournalTemplatesRepository,
    private readonly quotationsSchedulerService: QuotationsSchedulerService,
    private readonly invoicesSchedulerService: InvoicesSchedulerService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleDailyRecurringRun(): Promise<ScheduledRecurringRunSummary> {
    const recurringSummary = await this.runScheduledDueGenerations();
    await this.quotationsSchedulerService.runScheduledExpirations();
    await this.invoicesSchedulerService.runScheduledOverdueMarking();
    return recurringSummary;
  }

  /**
   * Invocable by cron and by tests. Optional asOfDate lets tests pin the
   * calendar day without fake timers.
   */
  async runScheduledDueGenerations(
    asOfDate?: string,
  ): Promise<ScheduledRecurringRunSummary> {
    const runDate = asOfDate ?? new Date().toISOString().slice(0, 10);
    const companyIds =
      await this.templatesRepository.listCompanyIdsWithActiveTemplates();

    const results: RecurringGenerationResult[] = [];
    const companyFailures: Array<{ company_id: string; error: string }> = [];
    let templatesEvaluated = 0;
    let entriesGenerated = 0;

    for (const companyId of companyIds) {
      try {
        const companyResults = await this.templatesService.runDueGenerations(
          companyId,
          runDate,
        );
        templatesEvaluated += companyResults.length;
        entriesGenerated += companyResults.filter(
          (r) => r.journal_entry != null,
        ).length;
        results.push(...companyResults);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        companyFailures.push({ company_id: companyId, error: message });
        this.logger.error(
          `Recurring schedule failed for company ${companyId}: ${message}`,
        );
      }
    }

    this.logger.log(
      `Recurring schedule as_of=${runDate}: companies=${companyIds.length}, ` +
        `templates_evaluated=${templatesEvaluated}, entries_generated=${entriesGenerated}, ` +
        `company_failures=${companyFailures.length}`,
    );

    return {
      as_of_date: runDate,
      companies_evaluated: companyIds.length,
      templates_evaluated: templatesEvaluated,
      entries_generated: entriesGenerated,
      company_failures: companyFailures,
      results,
    };
  }
}
