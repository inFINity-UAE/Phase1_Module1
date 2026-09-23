import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  ACCOUNTING_PERIODS_REPOSITORY,
  AccountingPeriodsRepository,
} from '../accounting-periods/accounting-periods.repository';
import { CompanyMembersService } from '../company-members/company-members.service';
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
 * templates, [feature-spec-1_1_C.md §8 decision #20] quotation expiration,
 * [decision #21] invoice overdue marking, [feature-spec-1_1_D.md §4.5b]
 * VAT-relief flags, and [§4.5a / D-10 / D-15] ECL provisioning at
 * period_end + 5 business days.
 *
 * Interval: once daily (01:00 UTC). One cron handler — no second scheduler.
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
    @Inject(ACCOUNTING_PERIODS_REPOSITORY)
    private readonly accountingPeriodsRepository: AccountingPeriodsRepository,
    private readonly companyMembersService: CompanyMembersService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleDailyRecurringRun(): Promise<ScheduledRecurringRunSummary> {
    const recurringSummary = await this.runScheduledDueGenerations();
    await this.runScheduledExpirations();
    await this.runScheduledOverdueMarking();
    await this.runScheduledVatReliefFlagging();
    await this.runScheduledEclProvisioning();
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

  /** [feature-spec-1_1_C.md §8 decision #20] valid_until → Expired. */
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

  /** [feature-spec-1_1_C.md §2.2 / §8 decision #21] due_date → Overdue. */
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
   * [feature-spec-1_1_D.md §4.5b] Flip write_offs.vat_relief_eligible when
   * 6mo-since-supply + debtor_notified_at hold. Same 01:00 UTC slot as overdue.
   */
  async runScheduledVatReliefFlagging(asOfDate?: string): Promise<{
    companies_evaluated: number;
    write_offs_flagged: number;
    company_failures: Array<{ company_id: string; error: string }>;
  }> {
    const runDate = asOfDate ?? new Date().toISOString().slice(0, 10);
    const companyIds =
      await this.invoicesRepository.listCompanyIdsWithUnflaggedWriteOffs();
    const sweep = await this.sweepCompanies(
      companyIds,
      'VAT relief eligibility',
      (companyId) =>
        this.invoicesRepository.markVatReliefEligible(companyId, runDate),
    );
    this.logger.log(
      `VAT relief eligibility as_of=${runDate}: companies=${sweep.companies_evaluated}, ` +
        `write_offs_flagged=${sweep.processed}, company_failures=${sweep.company_failures.length}`,
    );
    return {
      companies_evaluated: sweep.companies_evaluated,
      write_offs_flagged: sweep.processed,
      company_failures: sweep.company_failures,
    };
  }

  /**
   * [feature-spec-1_1_D.md §4.5a / D-10 / D-15]
   * Run run_ecl_provision when as_of >= add_business_days(period_end, 5).
   * Missed targets still execute (catch-up); unique + ecl: lock prevent double-post.
   */
  async runScheduledEclProvisioning(asOfDate?: string): Promise<{
    as_of_date: string;
    periods_evaluated: number;
    runs_completed: number;
    failures: Array<{ company_id: string; period_end: string; error: string }>;
  }> {
    const asOf = asOfDate ?? new Date().toISOString().slice(0, 10);
    const pending = await this.accountingPeriodsRepository.listPeriodsPendingEcl();
    const failures: Array<{ company_id: string; period_end: string; error: string }> =
      [];
    let runsCompleted = 0;

    for (const { company_id: companyId, period_end: periodEnd } of pending) {
      try {
        // [D-10] T+5 business days after period_end via D-P4 helper.
        const targetDate = await this.accountingPeriodsRepository.addBusinessDays(
          companyId,
          periodEnd,
          5,
        );
        if (targetDate > asOf) {
          continue;
        }

        const ownerId = await this.companyMembersService.findOwnerUserId(companyId);
        if (!ownerId) {
          failures.push({
            company_id: companyId,
            period_end: periodEnd,
            error: 'COMPANY_OWNER_NOT_FOUND',
          });
          this.logger.error(
            `ECL provision skipped for company ${companyId} period_end=${periodEnd}: no Owner`,
          );
          continue;
        }

        await this.accountingPeriodsRepository.runEclProvision(
          companyId,
          periodEnd,
          ownerId,
        );
        runsCompleted += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Race / catch-up re-entry — unique (company_id, period_end_date) already held.
        if (/ECL_PROVISION_ALREADY_RUN/i.test(message)) {
          continue;
        }
        failures.push({
          company_id: companyId,
          period_end: periodEnd,
          error: message,
        });
        this.logger.error(
          `ECL provision failed for company ${companyId} period_end=${periodEnd}: ${message}`,
        );
      }
    }

    this.logger.log(
      `ECL provision as_of=${asOf}: periods_evaluated=${pending.length}, ` +
        `runs_completed=${runsCompleted}, failures=${failures.length}`,
    );

    return {
      as_of_date: asOf,
      periods_evaluated: pending.length,
      runs_completed: runsCompleted,
      failures,
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
