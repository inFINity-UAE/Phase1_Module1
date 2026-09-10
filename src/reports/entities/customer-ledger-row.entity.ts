/** [feature-spec-1_1_D.md §5.1] One customer-ledger line from get_customer_ledger. */
export class CustomerLedgerRow {
  entry_date!: string;
  source_type!: string;
  source_id!: string;
  document_number!: string | null;
  description!: string;
  debit!: number;
  credit!: number;
  affects_ar!: boolean;
  running_balance!: number | null;
  journal_entry_id!: string;
}
