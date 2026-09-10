/** [feature-spec-1_1_D.md §5.5] Per-invoice payment timing row. */
export class CustomerPaymentHistoryInvoice {
  invoice_id!: string;
  invoice_number!: string | null;
  invoice_date!: string;
  paid_at!: string;
  payment_terms!: string;
  terms_days!: number;
  actual_days_to_pay!: number;
  days_vs_terms!: number;
}

/** [feature-spec-1_1_D.md §5.5] Payment history + DSO average. */
export class CustomerPaymentHistory {
  customer_id!: string;
  invoice_count!: number;
  average_actual_days_to_pay!: number | null;
  average_terms_days!: number | null;
  invoices!: CustomerPaymentHistoryInvoice[];
}
