export type ProfitAndLossAccountRow = {
  account_id: string;
  account_number: string;
  account_name: string;
  category: string;
  normal_balance: string;
  total_debit: number;
  total_credit: number;
  balance: number;
};

/**
 * [feature-spec-1.1.H.md decision #3] Single-period P&L response.
 * net_profit = total_income - total_expense (YE lockstep).
 */
export type ProfitAndLossReport = {
  period_start: string;
  period_end: string;
  accounts: ProfitAndLossAccountRow[];
  total_income: number;
  total_expense: number;
  net_profit: number;
};
