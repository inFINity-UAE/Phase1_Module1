import { ProfitAndLossAccountRow, ProfitAndLossReport } from './profit-and-loss.entity';

/** [feature-spec-1.1.H.md H2-1] One outer-joined account row. */
export type ProfitAndLossComparisonAccountRow = {
  account_id: string;
  account_number: string;
  account_name: string;
  category: string;
  normal_balance: string;
  period_a_total_debit: number;
  period_a_total_credit: number;
  period_a_balance: number;
  period_b_total_debit: number;
  period_b_total_credit: number;
  period_b_balance: number;
  variance: number;
};

export type ProfitAndLossComparisonReport = {
  period_a: ProfitAndLossReport;
  period_b: ProfitAndLossReport;
  accounts: ProfitAndLossComparisonAccountRow[];
};

export function comparisonRowToPeriodAccount(
  row: ProfitAndLossComparisonAccountRow,
  side: 'a' | 'b',
): ProfitAndLossAccountRow {
  return {
    account_id: row.account_id,
    account_number: row.account_number,
    account_name: row.account_name,
    category: row.category,
    normal_balance: row.normal_balance,
    total_debit: side === 'a' ? row.period_a_total_debit : row.period_b_total_debit,
    total_credit: side === 'a' ? row.period_a_total_credit : row.period_b_total_credit,
    balance: side === 'a' ? row.period_a_balance : row.period_b_balance,
  };
}
