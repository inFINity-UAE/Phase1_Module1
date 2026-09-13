/** [feature-spec-1_1_E.md §5.1] One supplier-ledger line from get_supplier_ledger. */
export class SupplierLedgerRow {
  entry_date!: string;
  source_type!: string;
  source_id!: string;
  document_number!: string | null;
  description!: string;
  debit!: number;
  credit!: number;
  affects_ap!: boolean;
  running_balance!: number | null;
  journal_entry_id!: string;
}
