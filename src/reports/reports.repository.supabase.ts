import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { AgedReceivablesRow } from './entities/aged-receivables-row.entity';
import { BalanceSheetAccountRow } from './entities/balance-sheet.entity';
import { CreditLimitCheck } from './entities/credit-limit-check.entity';
import { CustomerLedgerRow } from './entities/customer-ledger-row.entity';
import { CustomerPaymentHistory } from './entities/customer-payment-history.entity';
import { GeneralLedgerRow } from './entities/general-ledger-row.entity';
import { PeriodTrialBalanceRow } from './entities/period-trial-balance-row.entity';
import { ProfitAndLossAccountRow } from './entities/profit-and-loss.entity';
import { AgedPayablesRow } from './entities/aged-payables-row.entity';
import { BillsDueRow } from './entities/bills-due-row.entity';
import { ReportsRepository } from './reports.repository';
import { SupplierLedgerRow } from './entities/supplier-ledger-row.entity';


function asMoney(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number(value);
  }
  return 0;
}

function asInt(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number(value);
  }
  return 0;
}

@Injectable()
export class SupabaseReportsRepository implements ReportsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async findPeriodCompanyRow(
    periodId: string,
  ): Promise<{
    id: string;
    company_id: string;
    period_start: string | null;
    period_end: string | null;
  } | null> {
    const { data, error } = await this.supabase.client
      .from('accounting_periods')
      .select('id, company_id, period_start, period_end')
      .eq('id', periodId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as {
      id: string;
      company_id: string;
      period_start: string | null;
      period_end: string | null;
    } | null;
  }

  async findAccountCompanyRow(
    accountId: string,
  ): Promise<{ id: string; company_id: string; account_number: string | null } | null> {
    const { data, error } = await this.supabase.client
      .from('accounts')
      .select('id, company_id, account_number')
      .eq('id', accountId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as {
      id: string;
      company_id: string;
      account_number: string | null;
    } | null;
  }

  /**
   * [feature-spec-1.1.H1.md decision #1] Period Trial Balance RPC
   * (SECURITY INVOKER, service_role EXECUTE only — Module 1.1.A §5.1).
   */
  async getTrialBalanceForPeriod(
    companyId: string,
    periodId: string,
    includeZeroBalance = false,
  ): Promise<PeriodTrialBalanceRow[]> {
    const { data, error } = await this.supabase.client.rpc(
      'get_trial_balance_for_period',
      {
        p_company_id: companyId,
        p_period_id: periodId,
        p_include_zero_balance: includeZeroBalance,
      },
    );

    if (error) {
      throw error;
    }

    return ((data as Record<string, unknown>[]) ?? []).map((row) => ({
      account_id: String(row.account_id),
      account_number: String(row.account_number),
      account_name: String(row.account_name),
      category: String(row.category),
      normal_balance: String(row.normal_balance),
      opening_debit: asMoney(row.opening_debit),
      opening_credit: asMoney(row.opening_credit),
      opening_balance: asMoney(row.opening_balance),
      period_debit: asMoney(row.period_debit),
      period_credit: asMoney(row.period_credit),
      closing_debit: asMoney(row.closing_debit),
      closing_credit: asMoney(row.closing_credit),
      closing_balance: asMoney(row.closing_balance),
    }));
  }

  /**
   * [feature-spec-1.1.H1.md decision #2] Balance Sheet RPC
   * (SECURITY INVOKER, service_role EXECUTE only — Module 1.1.A §5.1).
   */
  async getBalanceSheet(
    companyId: string,
    asOfDate: string,
  ): Promise<BalanceSheetAccountRow[]> {
    const { data, error } = await this.supabase.client.rpc('get_balance_sheet', {
      p_company_id: companyId,
      p_as_of_date: asOfDate,
    });

    if (error) {
      throw error;
    }

    return ((data as Record<string, unknown>[]) ?? []).map((row) => ({
      account_id: String(row.account_id),
      account_number: String(row.account_number),
      account_name: String(row.account_name),
      category: String(row.category),
      normal_balance: String(row.normal_balance),
      total_debit: asMoney(row.total_debit),
      total_credit: asMoney(row.total_credit),
      balance: asMoney(row.balance),
    }));
  }

  /**
   * [feature-spec-1.1.H1.md decision #3] P&L RPC
   * (SECURITY INVOKER, service_role EXECUTE only — Module 1.1.A §5.1).
   */
  async getProfitAndLoss(
    companyId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<ProfitAndLossAccountRow[]> {
    const { data, error } = await this.supabase.client.rpc('get_profit_and_loss', {
      p_company_id: companyId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
    });

    if (error) {
      throw error;
    }

    return ((data as Record<string, unknown>[]) ?? []).map((row) => ({
      account_id: String(row.account_id),
      account_number: String(row.account_number),
      account_name: String(row.account_name),
      category: String(row.category),
      normal_balance: String(row.normal_balance),
      total_debit: asMoney(row.total_debit),
      total_credit: asMoney(row.total_credit),
      balance: asMoney(row.balance),
    }));
  }

  /**
   * [feature-spec-1.1.H1.md decision #5] General Ledger RPC
   * (SECURITY INVOKER, service_role EXECUTE only — Module 1.1.A §5.1).
   */
  async getGeneralLedger(
    companyId: string,
    accountId?: string | null,
    dateFrom?: string | null,
    dateTo?: string | null,
  ): Promise<GeneralLedgerRow[]> {
    const { data, error } = await this.supabase.client.rpc('get_general_ledger', {
      p_company_id: companyId,
      p_account_id: accountId ?? null,
      p_date_from: dateFrom ?? null,
      p_date_to: dateTo ?? null,
    });

    if (error) {
      throw error;
    }

    return ((data as Record<string, unknown>[]) ?? []).map((row) => ({
      journal_line_id: String(row.journal_line_id),
      journal_entry_id: String(row.journal_entry_id),
      entry_number: asInt(row.entry_number),
      entry_date: String(row.entry_date),
      narration: row.narration == null ? null : String(row.narration),
      entry_status: String(row.entry_status),
      account_id: String(row.account_id),
      account_number: String(row.account_number),
      account_name: String(row.account_name),
      normal_balance: String(row.normal_balance),
      line_number: asInt(row.line_number),
      debit: asMoney(row.debit),
      credit: asMoney(row.credit),
      line_balance: asMoney(row.line_balance),
      running_balance: asMoney(row.running_balance),
    }));
  }

  /** [feature-spec-1_1_D.md §5.1] Customer ledger RPC. */
  async getCustomerLedger(
    companyId: string,
    customerId: string,
    dateFrom?: string | null,
    dateTo?: string | null,
  ): Promise<CustomerLedgerRow[]> {
    const { data, error } = await this.supabase.client.rpc('get_customer_ledger', {
      p_company_id: companyId,
      p_customer_id: customerId,
      p_date_from: dateFrom ?? null,
      p_date_to: dateTo ?? null,
    });

    if (error) {
      throw error;
    }

    return ((data as Record<string, unknown>[]) ?? []).map((row) => ({
      entry_date: String(row.entry_date),
      source_type: String(row.source_type),
      source_id: String(row.source_id),
      document_number: row.document_number == null ? null : String(row.document_number),
      description: String(row.description),
      debit: asMoney(row.debit),
      credit: asMoney(row.credit),
      affects_ar: Boolean(row.affects_ar),
      running_balance: row.running_balance == null ? null : asMoney(row.running_balance),
      journal_entry_id: String(row.journal_entry_id),
    }));
  }

  /** [feature-spec-1_1_D.md §5.2] Aged receivables RPC. */
  async getAgedReceivables(
    companyId: string,
    asOfDate: string,
  ): Promise<AgedReceivablesRow[]> {
    const { data, error } = await this.supabase.client.rpc('get_aged_receivables', {
      p_company_id: companyId,
      p_as_of_date: asOfDate,
    });

    if (error) {
      throw error;
    }

    return ((data as Record<string, unknown>[]) ?? []).map((row) => ({
      customer_id: row.customer_id == null ? null : String(row.customer_id),
      customer_name: String(row.customer_name),
      is_totals: Boolean(row.is_totals),
      bucket_current: asMoney(row.bucket_current),
      bucket_0_30: asMoney(row.bucket_0_30),
      bucket_31_60: asMoney(row.bucket_31_60),
      bucket_61_90: asMoney(row.bucket_61_90),
      bucket_90_plus: asMoney(row.bucket_90_plus),
      total: asMoney(row.total),
    }));
  }

  /** [feature-spec-1_1_D.md §5.3 / D-4] Credit-limit check RPC. */
  async checkCustomerCreditLimit(
    companyId: string,
    customerId: string,
  ): Promise<CreditLimitCheck> {
    const { data, error } = await this.supabase.client.rpc('check_customer_credit_limit', {
      p_company_id: companyId,
      p_customer_id: customerId,
    });

    if (error) {
      throw error;
    }

    const row = data as Record<string, unknown>;
    return {
      customer_id: String(row.customer_id),
      credit_limit: row.credit_limit == null ? null : asMoney(row.credit_limit),
      open_invoice_outstanding: asMoney(row.open_invoice_outstanding),
      unapplied_advance_credit: asMoney(row.unapplied_advance_credit),
      outstanding_balance: asMoney(row.outstanding_balance),
      exceeds_credit_limit: Boolean(row.exceeds_credit_limit),
      alert: row.alert == null ? null : String(row.alert),
    };
  }

  /** [feature-spec-1_1_D.md §5.5] Payment history / DSO RPC. */
  async getCustomerPaymentHistory(
    companyId: string,
    customerId: string,
  ): Promise<CustomerPaymentHistory> {
    const { data, error } = await this.supabase.client.rpc(
      'get_customer_payment_history',
      {
        p_company_id: companyId,
        p_customer_id: customerId,
      },
    );

    if (error) {
      throw error;
    }

    const row = data as Record<string, unknown>;
    const invoices = ((row.invoices as Record<string, unknown>[]) ?? []).map((inv) => ({
      invoice_id: String(inv.invoice_id),
      invoice_number: inv.invoice_number == null ? null : String(inv.invoice_number),
      invoice_date: String(inv.invoice_date),
      paid_at: String(inv.paid_at),
      payment_terms: String(inv.payment_terms),
      terms_days: asInt(inv.terms_days),
      actual_days_to_pay: asInt(inv.actual_days_to_pay),
      days_vs_terms: asInt(inv.days_vs_terms),
    }));

    return {
      customer_id: String(row.customer_id),
      invoice_count: asInt(row.invoice_count),
      average_actual_days_to_pay:
        row.average_actual_days_to_pay == null
          ? null
          : asMoney(row.average_actual_days_to_pay),
      average_terms_days:
        row.average_terms_days == null ? null : asMoney(row.average_terms_days),
      invoices,
    };
  }

  async findCustomerCompanyRow(
    customerId: string,
  ): Promise<{ id: string; company_id: string } | null> {
    const { data, error } = await this.supabase.client
      .from('customers')
      .select('id, company_id')
      .eq('id', customerId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as { id: string; company_id: string } | null;
  }

  async findSupplierCompanyRow(
    supplierId: string,
  ): Promise<{ id: string; company_id: string } | null> {
    const { data, error } = await this.supabase.client
      .from('suppliers')
      .select('id, company_id')
      .eq('id', supplierId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as { id: string; company_id: string } | null;
  }

  /** [feature-spec-1_1_E.md §5.1] Supplier ledger RPC. */
  async getSupplierLedger(
    companyId: string,
    supplierId: string,
    dateFrom?: string | null,
    dateTo?: string | null,
  ): Promise<SupplierLedgerRow[]> {
    const { data, error } = await this.supabase.client.rpc('get_supplier_ledger', {
      p_company_id: companyId,
      p_supplier_id: supplierId,
      p_date_from: dateFrom ?? null,
      p_date_to: dateTo ?? null,
    });

    if (error) {
      throw error;
    }

    return ((data as Record<string, unknown>[]) ?? []).map((row) => ({
      entry_date: String(row.entry_date),
      source_type: String(row.source_type),
      source_id: String(row.source_id),
      document_number: row.document_number == null ? null : String(row.document_number),
      description: String(row.description),
      debit: asMoney(row.debit),
      credit: asMoney(row.credit),
      affects_ap: Boolean(row.affects_ap),
      running_balance: row.running_balance == null ? null : asMoney(row.running_balance),
      journal_entry_id: String(row.journal_entry_id),
    }));
  }

  /** [feature-spec-1_1_E.md §5.2] Aged payables RPC. */
  async getAgedPayables(companyId: string, asOfDate: string): Promise<AgedPayablesRow[]> {
    const { data, error } = await this.supabase.client.rpc('get_aged_payables', {
      p_company_id: companyId,
      p_as_of_date: asOfDate,
    });

    if (error) {
      throw error;
    }

    return ((data as Record<string, unknown>[]) ?? []).map((row) => ({
      supplier_id: row.supplier_id == null ? null : String(row.supplier_id),
      supplier_name: String(row.supplier_name),
      is_totals: Boolean(row.is_totals),
      bucket_current: asMoney(row.bucket_current),
      bucket_0_30: asMoney(row.bucket_0_30),
      bucket_31_60: asMoney(row.bucket_31_60),
      bucket_61_90: asMoney(row.bucket_61_90),
      bucket_90_plus: asMoney(row.bucket_90_plus),
      total: asMoney(row.total),
    }));
  }

  /** [feature-spec-1_1_E.md §5.2 / §5.4] Bills-due RPC. */
  async getBillsDue(companyId: string, asOfDate: string): Promise<BillsDueRow[]> {
    const { data, error } = await this.supabase.client.rpc('get_bills_due', {
      p_company_id: companyId,
      p_as_of_date: asOfDate,
    });

    if (error) {
      throw error;
    }

    return ((data as Record<string, unknown>[]) ?? []).map((row) => ({
      bill_id: String(row.bill_id),
      supplier_id: String(row.supplier_id),
      supplier_name: String(row.supplier_name),
      bill_number: row.bill_number == null ? null : String(row.bill_number),
      due_date: row.due_date == null ? null : String(row.due_date),
      scheduled_payment_date:
        row.scheduled_payment_date == null ? null : String(row.scheduled_payment_date),
      match_status: row.match_status == null ? null : String(row.match_status),
      outstanding: asMoney(row.outstanding),
    }));
  }

  /** [feature-spec-1_1_E.md §5.3 / E-22] Statement reconcile RPC. */
  async reconcileSupplierStatement(
    companyId: string,
    supplierId: string,
    statementDate: string,
  ): Promise<unknown> {
    const { data, error } = await this.supabase.client.rpc('reconcile_supplier_statement', {
      p_company_id: companyId,
      p_supplier_id: supplierId,
      p_statement_date: statementDate,
    });

    if (error) {
      throw error;
    }

    return data;
  }

  async getInvoiceRegister(companyId: string, year: number): Promise<unknown> {
    const { data, error } = await this.supabase.client.rpc('get_invoice_register', {
      p_company_id: companyId,
      p_year: year,
    });
    if (error) throw error;
    return data;
  }

  async assembleVatAuditPack(periodId: string): Promise<unknown> {
    const { data, error } = await this.supabase.client.rpc('assemble_vat_audit_pack', {
      p_period_id: periodId,
    });
    if (error) throw error;
    return data;
  }

  async getVatRegistrationThreshold(companyId: string, asOf: string): Promise<unknown> {
    const { data, error } = await this.supabase.client.rpc('get_vat_registration_threshold', {
      p_company_id: companyId,
      p_as_of: asOf,
    });
    if (error) throw error;
    return data;
  }
}
