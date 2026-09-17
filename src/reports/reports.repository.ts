import { PeriodTrialBalanceRow } from './entities/period-trial-balance-row.entity';
import { BalanceSheetAccountRow } from './entities/balance-sheet.entity';
import { GeneralLedgerRow } from './entities/general-ledger-row.entity';
import { ProfitAndLossAccountRow } from './entities/profit-and-loss.entity';
import { AgedReceivablesRow } from './entities/aged-receivables-row.entity';
import { CreditLimitCheck } from './entities/credit-limit-check.entity';
import { CustomerLedgerRow } from './entities/customer-ledger-row.entity';
import { CustomerPaymentHistory } from './entities/customer-payment-history.entity';
import { AgedPayablesRow } from './entities/aged-payables-row.entity';
import { BillsDueRow } from './entities/bills-due-row.entity';
import { SupplierLedgerRow } from './entities/supplier-ledger-row.entity';

export const REPORTS_REPOSITORY = Symbol('REPORTS_REPOSITORY');

export interface ReportsRepository {
  getTrialBalanceForPeriod(
    companyId: string,
    periodId: string,
    includeZeroBalance?: boolean,
  ): Promise<PeriodTrialBalanceRow[]>;

  getBalanceSheet(
    companyId: string,
    asOfDate: string,
  ): Promise<BalanceSheetAccountRow[]>;

  getProfitAndLoss(
    companyId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<ProfitAndLossAccountRow[]>;

  getGeneralLedger(
    companyId: string,
    accountId?: string | null,
    dateFrom?: string | null,
    dateTo?: string | null,
  ): Promise<GeneralLedgerRow[]>;

  /** [feature-spec-1_1_D.md §5.1] */
  getCustomerLedger(
    companyId: string,
    customerId: string,
    dateFrom?: string | null,
    dateTo?: string | null,
  ): Promise<CustomerLedgerRow[]>;

  /** [feature-spec-1_1_D.md §5.2] */
  getAgedReceivables(companyId: string, asOfDate: string): Promise<AgedReceivablesRow[]>;

  /** [feature-spec-1_1_D.md §5.3 / D-4] */
  checkCustomerCreditLimit(
    companyId: string,
    customerId: string,
  ): Promise<CreditLimitCheck>;

  /** [feature-spec-1_1_D.md §5.5] */
  getCustomerPaymentHistory(
    companyId: string,
    customerId: string,
  ): Promise<CustomerPaymentHistory>;

  findPeriodCompanyRow(
    periodId: string,
  ): Promise<{ id: string; company_id: string; period_start: string | null; period_end: string | null } | null>;

  findAccountCompanyRow(
    accountId: string,
  ): Promise<{ id: string; company_id: string; account_number: string | null } | null>;

  findCustomerCompanyRow(
    customerId: string,
  ): Promise<{ id: string; company_id: string } | null>;

  findSupplierCompanyRow(
    supplierId: string,
  ): Promise<{ id: string; company_id: string } | null>;

  /** [feature-spec-1_1_E.md §5.1] */
  getSupplierLedger(
    companyId: string,
    supplierId: string,
    dateFrom?: string | null,
    dateTo?: string | null,
  ): Promise<SupplierLedgerRow[]>;

  /** [feature-spec-1_1_E.md §5.2] */
  getAgedPayables(companyId: string, asOfDate: string): Promise<AgedPayablesRow[]>;

  /** [feature-spec-1_1_E.md §5.2 / §5.4] */
  getBillsDue(companyId: string, asOfDate: string): Promise<BillsDueRow[]>;

  /** [feature-spec-1_1_E.md §5.3 / E-22] */
  reconcileSupplierStatement(
    companyId: string,
    supplierId: string,
    statementDate: string,
  ): Promise<unknown>;

  getInvoiceRegister(companyId: string, year: number): Promise<unknown>;
  assembleVatAuditPack(periodId: string): Promise<unknown>;
  getVatRegistrationThreshold(companyId: string, asOf: string): Promise<unknown>;
}
