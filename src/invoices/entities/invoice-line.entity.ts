/** Row shape for `invoice_lines` — [feature-spec-1.1.C.md §1.3]. */
export class InvoiceLine {
  id!: string;
  invoice_id!: string;
  line_number!: number;
  description!: string;
  quantity!: number;
  unit_price!: number;
  discount_percent!: number | null;
  discount_amount!: number | null;
  vat_rate!: number;
  is_service!: boolean;
  income_account_id!: string | null;
  line_total!: number;
}
