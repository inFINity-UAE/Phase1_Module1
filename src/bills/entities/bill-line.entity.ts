/** Row shape for `bill_lines` — [feature-spec-1_1_E.md §3.3]. */
export class BillLine {
  id!: string;
  bill_id!: string;
  line_number!: number;
  purchase_order_line_id!: string | null;
  description!: string;
  quantity!: number;
  unit_price!: number;
  discount_percent!: number | null;
  discount_amount!: number | null;
  vat_rate!: number;
  account_id!: string | null;
  line_total!: number;
}
