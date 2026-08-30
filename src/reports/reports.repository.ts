import { PeriodTrialBalanceRow } from './entities/period-trial-balance-row.entity';
import { BalanceSheetAccountRow } from './entities/balance-sheet.entity';
import { GeneralLedgerRow } from './entities/general-ledger-row.entity';
import { ProfitAndLossAccountRow } from './entities/profit-and-loss.entity';

export const REPORTS_REPOSITORY = Symbol('REPORTS_REPOSITORY');

export interface ReportsRepository {
  /**
   * [feature-spec-1.1.H1.md decision #1] RPC get_trial_balance_for_period.
   */
  getTrialBalanceForPeriod(
    companyId: string,
    periodId: string,
    includeZeroBalance?: boolean,
  ): Promise<PeriodTrialBalanceRow[]>;

  /**
   * [feature-spec-1.1.H1.md decision #2] RPC get_balance_sheet.
   */
  getBalanceSheet(
    companyId: string,
    asOfDate: string,
  ): Promise<BalanceSheetAccountRow[]>;

  /**
   * [feature-spec-1.1.H1.md decision #3] RPC get_profit_and_loss.
   */
  getProfitAndLoss(
    companyId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<ProfitAndLossAccountRow[]>;

  /**
   * [feature-spec-1.1.H1.md decision #5] RPC get_general_ledger.
   */
  getGeneralLedger(
    companyId: string,
    accountId?: string | null,
    dateFrom?: string | null,
    dateTo?: string | null,
  ): Promise<GeneralLedgerRow[]>;

  findPeriodCompanyRow(
    periodId: string,
  ): Promise<{ id: string; company_id: string; period_start: string | null; period_end: string | null } | null>;

  findAccountCompanyRow(
    accountId: string,
  ): Promise<{ id: string; company_id: string; account_number: string | null } | null>;
}
