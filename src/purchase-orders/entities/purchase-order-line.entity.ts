/** Row shape for `purchase_order_lines` — [feature-spec-1_1_E.md §3.5]. */
export class PurchaseOrderLine {
  id!: string;
  po_id!: string;
  line_number!: number;
  description!: string;
  quantity!: number;
  unit_price!: number;
  account_id!: string;
  line_total!: number;
}
