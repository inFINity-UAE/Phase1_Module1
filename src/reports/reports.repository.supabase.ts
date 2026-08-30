import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { BalanceSheetAccountRow } from './entities/balance-sheet.entity';
import { GeneralLedgerRow } from './entities/general-ledger-row.entity';
import { PeriodTrialBalanceRow } from './entities/period-trial-balance-row.entity';
import { ProfitAndLossAccountRow } from './entities/profit-and-loss.entity';
import { ReportsRepository } from './reports.repository';


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
}
