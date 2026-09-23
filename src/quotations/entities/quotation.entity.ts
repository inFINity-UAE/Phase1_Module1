import { QuotationStatus } from '../common/enums/quotation-status.enum';

/** Row shape for `quotations` — [feature-spec-1_1_C.md §1.2]. */
export class Quotation {
  id!: string;
  company_id!: string;
  customer_id!: string;
  quotation_number!: string;
  quotation_date!: string;
  valid_until!: string | null;
  status!: QuotationStatus;
  subtotal!: number;
  vat_total!: number;
  grand_total!: number;
  notes!: string | null;
  converted_to_invoice_id!: string | null;
  created_by!: string;
  created_at!: string;
  updated_at!: string;
}
