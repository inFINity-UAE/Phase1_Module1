import { AccountingPeriod } from './entities/accounting-period.entity';

export const ACCOUNTING_PERIODS_REPOSITORY = Symbol('ACCOUNTING_PERIODS_REPOSITORY');

export interface AccountingPeriodsRepository {
  findById(id: string): Promise<AccountingPeriod | null>;
  softClose(id: string, closedBy: string): Promise<AccountingPeriod>;
  logSoftClosedPostingOverride(
    periodId: string,
    actorId: string,
    reason: string,
  ): Promise<AccountingPeriod>;
}
