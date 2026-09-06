import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { INVOICES_REPOSITORY, InvoicesRepository } from '../invoices/invoices.repository';
import {
  QUOTATIONS_REPOSITORY,
  QuotationsRepository,
} from '../quotations/quotations.repository';
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

type CompanySweepSummary = {
  companies_evaluated: number;
  processed: number;
  company_failures: Array<{ company_id: string; error: string }>;
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
    @Inject(QUOTATIONS_REPOSITORY)
    private readonly quotationsRepository: QuotationsRepository,
    @Inject(INVOICES_REPOSITORY)
    private readonly invoicesRepository: InvoicesRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleDailyRecurringRun(): Promise<ScheduledRecurringRunSummary> {
    const recurringSummary = await this.runScheduledDueGenerations();
    await this.runScheduledExpirations();
    await this.runScheduledOverdueMarking();
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
    const sweep = await this.sweepCompanies(
      companyIds,
      'Recurring schedule',
      async (companyId) => {
        const companyResults = await this.templatesService.runDueGenerations(
          companyId,
          runDate,
        );
        results.push(...companyResults);
        return companyResults.filter((r) => r.journal_entry != null).length;
      },
    );

    this.logger.log(
      `Recurring schedule as_of=${runDate}: companies=${sweep.companies_evaluated}, ` +
        `templates_evaluated=${results.length}, entries_generated=${sweep.processed}, ` +
        `company_failures=${sweep.company_failures.length}`,
    );

    return {
      as_of_date: runDate,
      companies_evaluated: sweep.companies_evaluated,
      templates_evaluated: results.length,
      entries_generated: sweep.processed,
      company_failures: sweep.company_failures,
      results,
    };
  }

  /** [feature-spec-1.1.C.md §8 decision #20] valid_until → Expired. */
  async runScheduledExpirations(): Promise<{
    companies_evaluated: number;
    quotations_expired: number;
    company_failures: Array<{ company_id: string; error: string }>;
  }> {
    const companyIds =
      await this.quotationsRepository.listCompanyIdsWithOpenQuotations();
    const sweep = await this.sweepCompanies(
      companyIds,
      'Quotation expiration',
      (companyId) => this.quotationsRepository.expireDueQuotations(companyId),
    );
    this.logger.log(
      `Quotation expiration: companies=${sweep.companies_evaluated}, ` +
        `quotations_expired=${sweep.processed}, company_failures=${sweep.company_failures.length}`,
    );
    return {
      companies_evaluated: sweep.companies_evaluated,
      quotations_expired: sweep.processed,
      company_failures: sweep.company_failures,
    };
  }

  /** [feature-spec-1.1.C.md §2.2 / §8 decision #21] due_date → Overdue. */
  async runScheduledOverdueMarking(): Promise<{
    companies_evaluated: number;
    invoices_marked_overdue: number;
    company_failures: Array<{ company_id: string; error: string }>;
  }> {
    const companyIds =
      await this.invoicesRepository.listCompanyIdsWithOpenInvoices();
    const sweep = await this.sweepCompanies(
      companyIds,
      'Invoice overdue marking',
      (companyId) => this.invoicesRepository.markOverdueInvoices(companyId),
    );
    this.logger.log(
      `Invoice overdue marking: companies=${sweep.companies_evaluated}, ` +
        `invoices_marked_overdue=${sweep.processed}, company_failures=${sweep.company_failures.length}`,
    );
    return {
      companies_evaluated: sweep.companies_evaluated,
      invoices_marked_overdue: sweep.processed,
      company_failures: sweep.company_failures,
    };
  }

  /**
   * ponytail: companies processed sequentially. Ceiling: 01:00 UTC wall clock
   * grows with tenant count. Upgrade: bounded parallelism if the daily slot overruns.
   */
  private async sweepCompanies(
    companyIds: string[],
    label: string,
    fn: (companyId: string) => Promise<number>,
  ): Promise<CompanySweepSummary> {
    const companyFailures: Array<{ company_id: string; error: string }> = [];
    let processed = 0;

    for (const companyId of companyIds) {
      try {
        processed += await fn(companyId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        companyFailures.push({ company_id: companyId, error: message });
        this.logger.error(`${label} failed for company ${companyId}: ${message}`);
      }
    }

    return {
      companies_evaluated: companyIds.length,
      processed,
      company_failures: companyFailures,
    };
  }
}
