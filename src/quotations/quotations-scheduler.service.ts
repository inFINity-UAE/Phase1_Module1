import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  QUOTATIONS_REPOSITORY,
  QuotationsRepository,
} from './quotations.repository';

export type ScheduledQuotationExpirationSummary = {
  companies_evaluated: number;
  quotations_expired: number;
  company_failures: Array<{ company_id: string; error: string }>;
};

/**
 * [feature-spec-1.1.C.md §8 / decision #6] Unattended valid_until → Expired
 * sweep. Invoked from RecurringJournalSchedulerService's daily 01:00 UTC cron
 * immediately after recurring due generation (decision #20).
 */
@Injectable()
export class QuotationsSchedulerService {
  private readonly logger = new Logger(QuotationsSchedulerService.name);

  constructor(
    @Inject(QUOTATIONS_REPOSITORY)
    private readonly quotationsRepository: QuotationsRepository,
  ) {}

  async runScheduledExpirations(): Promise<ScheduledQuotationExpirationSummary> {
    const companyIds =
      await this.quotationsRepository.listCompanyIdsWithOpenQuotations();

    const companyFailures: Array<{ company_id: string; error: string }> = [];
    let quotationsExpired = 0;

    for (const companyId of companyIds) {
      try {
        const count = await this.quotationsRepository.expireDueQuotations(companyId);
        quotationsExpired += count;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        companyFailures.push({ company_id: companyId, error: message });
        this.logger.error(
          `Quotation expiration failed for company ${companyId}: ${message}`,
        );
      }
    }

    this.logger.log(
      `Quotation expiration: companies=${companyIds.length}, ` +
        `quotations_expired=${quotationsExpired}, company_failures=${companyFailures.length}`,
    );

    return {
      companies_evaluated: companyIds.length,
      quotations_expired: quotationsExpired,
      company_failures: companyFailures,
    };
  }
}
