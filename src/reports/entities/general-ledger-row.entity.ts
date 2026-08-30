/**
 * [feature-spec-1.1.H1.md decision #5] One General Ledger row per
 * journal_lines entry (ledger-truth parent), with per-account running balance.
 */
export type GeneralLedgerRow = {
  journal_line_id: string;
  journal_entry_id: string;
  entry_number: number;
  entry_date: string;
  narration: string | null;
  entry_status: string;
  account_id: string;
  account_number: string;
  account_name: string;
  normal_balance: string;
  line_number: number;
  debit: number;
  credit: number;
  line_balance: number;
  running_balance: number;
};
