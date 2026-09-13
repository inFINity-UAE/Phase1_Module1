/** Row shape for `goods_receipt_lines` — [feature-spec-1_1_E.md §3.7]. */
export class GoodsReceiptLine {
  id!: string;
  goods_receipt_id!: string;
  purchase_order_line_id!: string;
  quantity_received!: number;
}
