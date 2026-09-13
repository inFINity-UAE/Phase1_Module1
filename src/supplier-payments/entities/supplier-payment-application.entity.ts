/** Row shape for `supplier_payment_applications` — [feature-spec-1_1_E.md §3.5]. */
export class SupplierPaymentApplication {
  id!: string;
  supplier_payment_id!: string;
  bill_id!: string;
  applied_amount!: number;
  applied_at!: string;
  applied_by!: string;
  journal_entry_id!: string | null;
}
