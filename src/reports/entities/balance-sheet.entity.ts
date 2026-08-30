export type BalanceSheetAccountRow = {
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
 * [feature-spec-1.1.H1.md decision #2] Balance Sheet response with
 * account rows plus A = L + E sanity totals.
 */
export type BalanceSheetReport = {
  as_of_date: string;
  accounts: BalanceSheetAccountRow[];
  total_assets: number;
  total_liabilities: number;
  total_equity: number;
  is_balanced: boolean;
};
