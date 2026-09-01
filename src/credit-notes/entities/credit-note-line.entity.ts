export class CreditNoteLine {
  id!: string;
  credit_note_id!: string;
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
  original_invoice_line_id!: string | null;
  reason!: string | null;
}
