/** Row shape for `quotation_lines` — [feature-spec-1.1.C.md §1.2]. */
export class QuotationLine {
  id!: string;
  quotation_id!: string;
  line_number!: number;
  description!: string;
  quantity!: number;
  unit_price!: number;
  discount_percent!: number | null;
  discount_amount!: number | null;
  vat_rate!: number;
  is_service!: boolean;
  line_total!: number;
}
