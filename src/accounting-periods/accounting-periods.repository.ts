import { AccountingPeriod } from './entities/accounting-period.entity';

export const ACCOUNTING_PERIODS_REPOSITORY = Symbol('ACCOUNTING_PERIODS_REPOSITORY');

export interface CreateAccountingPeriodRecord {
  company_id: string;
  period_start: string;
  period_end: string;
  fiscal_year: number;
}

export interface UpdateAccountingPeriodRecord {
  period_start?: string;
  period_end?: string;
  fiscal_year?: number;
}

export interface AccountingPeriodsRepository {
  findById(id: string): Promise<AccountingPeriod | null>;
  findByCompanyId(companyId: string): Promise<AccountingPeriod[]>;
  create(record: CreateAccountingPeriodRecord): Promise<AccountingPeriod>;
  update(id: string, patch: UpdateAccountingPeriodRecord): Promise<AccountingPeriod>;
  /**
   * True when another period for the same company overlaps [periodStart, periodEnd)
   * using the standard interval test: start < otherEnd AND end > otherStart.
   * [feature-spec.md #38] DB exclusion constraint is the concurrent-write backstop;
   * this remains the normal-path application-layer check.
   */
  hasOverlappingPeriod(
    companyId: string,
    periodStart: string,
    periodEnd: string,
    excludePeriodId?: string,
  ): Promise<boolean>;
  /** True when any journal_entries row for this period has status = 'posted'. */
  hasPostedJournalActivity(periodId: string): Promise<boolean>;
  softClose(id: string, closedBy: string): Promise<AccountingPeriod>;
  logSoftClosedPostingOverride(
    periodId: string,
    actorId: string,
    reason: string,
  ): Promise<AccountingPeriod>;
}
