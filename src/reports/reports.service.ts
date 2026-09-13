import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { handleDatabaseError } from '../common/errors/database-error.mapper';
import { assertAccountBelongsToCompany } from '../journal-entries/journal-line-account.validation';
import { assertPeriodUsableForCompany } from '../journal-entries/journal-period.validation';
import { AgedReceivablesRow } from './entities/aged-receivables-row.entity';
import {
  BalanceSheetAccountRow,
  BalanceSheetReport,
} from './entities/balance-sheet.entity';
import { CreditLimitCheck } from './entities/credit-limit-check.entity';
import { CustomerLedgerRow } from './entities/customer-ledger-row.entity';
import { CustomerPaymentHistory } from './entities/customer-payment-history.entity';
import { AgedPayablesRow } from './entities/aged-payables-row.entity';
import { BillsDueRow } from './entities/bills-due-row.entity';
import { SupplierLedgerRow } from './entities/supplier-ledger-row.entity';
import { GeneralLedgerRow } from './entities/general-ledger-row.entity';
import { PeriodTrialBalanceRow } from './entities/period-trial-balance-row.entity';
import {
  ProfitAndLossAccountRow,
  ProfitAndLossReport,
} from './entities/profit-and-loss.entity';
import { REPORTS_REPOSITORY, ReportsRepository } from './reports.repository';


/** [feature-spec-1.1.H1.md decision #2] Server today as YYYY-MM-DD (UTC calendar date). */
export function serverAsOfDateToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * [feature-spec-1.1.H1.md decision #2] Sum signed balances by A/L/E and
 * set is_balanced when total_assets = total_liabilities + total_equity.
 */
export function summarizeBalanceSheet(
  asOfDate: string,
  accounts: BalanceSheetAccountRow[],
): BalanceSheetReport {
  let totalAssets = 0;
  let totalLiabilities = 0;
  let totalEquity = 0;

  for (const row of accounts) {
    if (row.category === 'asset') {
      totalAssets += row.balance;
    } else if (row.category === 'liability') {
      totalLiabilities += row.balance;
    } else if (row.category === 'equity') {
      totalEquity += row.balance;
    }
  }

  totalAssets = roundMoney(totalAssets);
  totalLiabilities = roundMoney(totalLiabilities);
  totalEquity = roundMoney(totalEquity);

  return {
    as_of_date: asOfDate,
    accounts,
    total_assets: totalAssets,
    total_liabilities: totalLiabilities,
    total_equity: totalEquity,
    is_balanced:
      Math.round(totalAssets * 100) ===
      Math.round((totalLiabilities + totalEquity) * 100),
  };
}

/**
 * [feature-spec-1.1.H1.md decision #3] net_profit = total_income − total_expense
 * using the same category split as create_year_end_closing_entry
 * (income balances → YE v_total_debits; expense → v_total_credits; net = debit−credit).
 */
export function summarizeProfitAndLoss(
  periodStart: string,
  periodEnd: string,
  accounts: ProfitAndLossAccountRow[],
): ProfitAndLossReport {
  let totalIncome = 0;
  let totalExpense = 0;

  for (const row of accounts) {
    if (row.category === 'income') {
      totalIncome += row.balance;
    } else if (row.category === 'expense') {
      totalExpense += row.balance;
    }
  }

  totalIncome = roundMoney(totalIncome);
  totalExpense = roundMoney(totalExpense);

  return {
    period_start: periodStart,
    period_end: periodEnd,
    accounts,
    total_income: totalIncome,
    total_expense: totalExpense,
    net_profit: roundMoney(totalIncome - totalExpense),
  };
}

@Injectable()
export class ReportsService {
  constructor(
    @Inject(REPORTS_REPOSITORY)
    private readonly reportsRepository: ReportsRepository,
  ) {}

  /**
   * [feature-spec-1.1.H1.md decision #1] Period Trial Balance.
   * Period ownership check mirrors Module 1.1.A §4.18 / decision #51
   * (assertPeriodUsableForCompany) — no parallel same-company helper.
   */
  async getTrialBalance(
    companyId: string,
    periodId: string,
    includeZeroBalance = false,
  ): Promise<PeriodTrialBalanceRow[]> {
    try {
      const period = await this.reportsRepository.findPeriodCompanyRow(periodId);
      assertPeriodUsableForCompany(companyId, periodId, period);

      return await this.reportsRepository.getTrialBalanceForPeriod(
        companyId,
        periodId,
        includeZeroBalance,
      );
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec-1.1.H1.md decision #2] Balance Sheet as of a date.
   * Omitted as_of_date → server today (not client-trusted).
   */
  async getBalanceSheet(
    companyId: string,
    asOfDate?: string,
  ): Promise<BalanceSheetReport> {
    try {
      const resolvedAsOf = asOfDate ?? serverAsOfDateToday();
      const accounts = await this.reportsRepository.getBalanceSheet(
        companyId,
        resolvedAsOf,
      );
      return summarizeBalanceSheet(resolvedAsOf, accounts);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec-1.1.H1.md decision #3] Single-period P&L.
   * Rejects period_end < period_start in Nest (clear 400) before RPC.
   */
  async getProfitAndLoss(
    companyId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<ProfitAndLossReport> {
    if (periodEnd < periodStart) {
      throw new BadRequestException(
        `period_end (${periodEnd}) must be on or after period_start (${periodStart})`,
      );
    }

    try {
      const accounts = await this.reportsRepository.getProfitAndLoss(
        companyId,
        periodStart,
        periodEnd,
      );
      return summarizeProfitAndLoss(periodStart, periodEnd, accounts);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec-1.1.H1.md decision #5] General Ledger — line listing with
   * true cumulative running balance. Optional account_id uses
   * assertAccountBelongsToCompany (§4.8/#35 company-match; inactive OK).
   * Nest rejects inverted date range before RPC.
   */
  async getGeneralLedger(
    companyId: string,
    accountId?: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<GeneralLedgerRow[]> {
    if (dateFrom != null && dateTo != null && dateTo < dateFrom) {
      throw new BadRequestException(
        `date_to (${dateTo}) must be on or after date_from (${dateFrom})`,
      );
    }

    try {
      if (accountId) {
        const account =
          await this.reportsRepository.findAccountCompanyRow(accountId);
        assertAccountBelongsToCompany(companyId, accountId, account);
      }

      return await this.reportsRepository.getGeneralLedger(
        companyId,
        accountId ?? null,
        dateFrom ?? null,
        dateTo ?? null,
      );
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  private async assertCustomerUsableForCompany(
    companyId: string,
    customerId: string,
  ): Promise<void> {
    const customer = await this.reportsRepository.findCustomerCompanyRow(customerId);
    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }
    if (customer.company_id !== companyId) {
      throw new BadRequestException(
        `Customer ${customerId} does not belong to company ${companyId}`,
      );
    }
  }

  /**
   * [feature-spec-1_1_D.md §5.1] Customer ledger — thin RPC pass-through.
   */
  async getCustomerLedger(
    companyId: string,
    customerId: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<CustomerLedgerRow[]> {
    if (dateFrom != null && dateTo != null && dateTo < dateFrom) {
      throw new BadRequestException(
        `date_to (${dateTo}) must be on or after date_from (${dateFrom})`,
      );
    }

    try {
      await this.assertCustomerUsableForCompany(companyId, customerId);
      return await this.reportsRepository.getCustomerLedger(
        companyId,
        customerId,
        dateFrom ?? null,
        dateTo ?? null,
      );
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec-1_1_D.md §5.4] Statement data = customer ledger (PDF deferred).
   */
  async getCustomerStatement(
    companyId: string,
    customerId: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<CustomerLedgerRow[]> {
    return this.getCustomerLedger(companyId, customerId, dateFrom, dateTo);
  }

  /**
   * [feature-spec-1_1_D.md §5.2 / D-5] Aged receivables.
   */
  async getAgedReceivables(
    companyId: string,
    asOfDate?: string,
  ): Promise<AgedReceivablesRow[]> {
    try {
      const resolvedAsOf = asOfDate ?? serverAsOfDateToday();
      return await this.reportsRepository.getAgedReceivables(companyId, resolvedAsOf);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec-1_1_D.md §5.3 / D-4] Credit-limit check (alert only).
   */
  async checkCustomerCreditLimit(
    companyId: string,
    customerId: string,
  ): Promise<CreditLimitCheck> {
    try {
      await this.assertCustomerUsableForCompany(companyId, customerId);
      return await this.reportsRepository.checkCustomerCreditLimit(
        companyId,
        customerId,
      );
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec-1_1_D.md §5.5] Payment history / DSO.
   */
  async getCustomerPaymentHistory(
    companyId: string,
    customerId: string,
  ): Promise<CustomerPaymentHistory> {
    try {
      await this.assertCustomerUsableForCompany(companyId, customerId);
      return await this.reportsRepository.getCustomerPaymentHistory(
        companyId,
        customerId,
      );
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  private async assertSupplierUsableForCompany(
    companyId: string,
    supplierId: string,
  ): Promise<void> {
    const supplier = await this.reportsRepository.findSupplierCompanyRow(supplierId);
    if (!supplier) {
      throw new NotFoundException(`Supplier ${supplierId} not found`);
    }
    if (supplier.company_id !== companyId) {
      throw new BadRequestException(
        `Supplier ${supplierId} does not belong to company ${companyId}`,
      );
    }
  }

  /** [feature-spec-1_1_E.md §5.1] Supplier ledger — thin RPC pass-through. */
  async getSupplierLedger(
    companyId: string,
    supplierId: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<SupplierLedgerRow[]> {
    if (dateFrom != null && dateTo != null && dateTo < dateFrom) {
      throw new BadRequestException(
        `date_to (${dateTo}) must be on or after date_from (${dateFrom})`,
      );
    }

    try {
      await this.assertSupplierUsableForCompany(companyId, supplierId);
      return await this.reportsRepository.getSupplierLedger(
        companyId,
        supplierId,
        dateFrom ?? null,
        dateTo ?? null,
      );
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /** [feature-spec-1_1_E.md §5.2] Aged payables. */
  async getAgedPayables(companyId: string, asOfDate?: string): Promise<AgedPayablesRow[]> {
    try {
      const resolvedAsOf = asOfDate ?? serverAsOfDateToday();
      return await this.reportsRepository.getAgedPayables(companyId, resolvedAsOf);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /** [feature-spec-1_1_E.md §5.2 / §5.4] Open bills due. */
  async getBillsDue(companyId: string, asOfDate?: string): Promise<BillsDueRow[]> {
    try {
      const resolvedAsOf = asOfDate ?? serverAsOfDateToday();
      return await this.reportsRepository.getBillsDue(companyId, resolvedAsOf);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /** [feature-spec-1_1_E.md §5.3 / E-22] Suggested statement match. */
  async reconcileSupplierStatement(
    companyId: string,
    supplierId: string,
    statementDate: string,
  ): Promise<unknown> {
    try {
      await this.assertSupplierUsableForCompany(companyId, supplierId);
      return await this.reportsRepository.reconcileSupplierStatement(
        companyId,
        supplierId,
        statementDate,
      );
    } catch (error) {
      handleDatabaseError(error);
    }
  }
}
