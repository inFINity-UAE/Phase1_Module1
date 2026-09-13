/** Row shape for `supplier_payment_run_items`. */
export class SupplierPaymentRunItem {
  id!: string;
  run_id!: string;
  bill_id!: string;
  supplier_id!: string;
  amount_to_pay!: number;
  included!: boolean;
}
