import { Inject, Injectable, Logger } from '@nestjs/common';
import { INVOICES_REPOSITORY, InvoicesRepository } from './invoices.repository';

export type ScheduledInvoiceOverdueSummary = {
  companies_evaluated: number;
  invoices_marked_overdue: number;
  company_failures: Array<{ company_id: string; error: string }>;
};

/**
 * [feature-spec-1.1.C.md §2.2 / §8 decision #7] Unattended due_date → Overdue
 * sweep. Invoked from RecurringJournalSchedulerService's daily 01:00 UTC cron
 * immediately after quotation expiration (decision #21).
 */
@Injectable()
export class InvoicesSchedulerService {
  private readonly logger = new Logger(InvoicesSchedulerService.name);

  constructor(
    @Inject(INVOICES_REPOSITORY)
    private readonly invoicesRepository: InvoicesRepository,
  ) {}

  async runScheduledOverdueMarking(): Promise<ScheduledInvoiceOverdueSummary> {
    const companyIds =
      await this.invoicesRepository.listCompanyIdsWithOpenInvoices();

    const companyFailures: Array<{ company_id: string; error: string }> = [];
    let invoicesMarkedOverdue = 0;

    for (const companyId of companyIds) {
      try {
        const count =
          await this.invoicesRepository.markOverdueInvoices(companyId);
        invoicesMarkedOverdue += count;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        companyFailures.push({ company_id: companyId, error: message });
        this.logger.error(
          `Invoice overdue marking failed for company ${companyId}: ${message}`,
        );
      }
    }

    this.logger.log(
      `Invoice overdue marking: companies=${companyIds.length}, ` +
        `invoices_marked_overdue=${invoicesMarkedOverdue}, company_failures=${companyFailures.length}`,
    );

    return {
      companies_evaluated: companyIds.length,
      invoices_marked_overdue: invoicesMarkedOverdue,
      company_failures: companyFailures,
    };
  }
}
