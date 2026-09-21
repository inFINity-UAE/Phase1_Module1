/** [feature-spec-1.1.H.md H2-5 / H2-14] Per-customer sales after CN netting. */
export type SalesByCustomerRow = {
  customer_id: string;
  total_revenue: number;
  invoice_count: number;
  average_invoice_value: number | null;
};
