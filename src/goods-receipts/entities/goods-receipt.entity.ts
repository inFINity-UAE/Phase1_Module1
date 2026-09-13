/** Row shape for `goods_receipts` — [feature-spec-1_1_E.md §3.6]. */
export class GoodsReceipt {
  id!: string;
  company_id!: string;
  supplier_id!: string;
  purchase_order_id!: string;
  receipt_number!: string;
  receipt_date!: string;
  created_by!: string;
  created_at!: string;
}
