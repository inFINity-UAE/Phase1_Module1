import { InvoiceStatus } from '../common/enums/invoice-status.enum';
import { InvoiceType } from '../common/enums/invoice-type.enum';
import { PaymentTermsType } from '../common/enums/payment-terms-type.enum';

/** Row shape for `invoices` — [feature-spec-1_1_C.md §1.3]. */
export class Invoice {
  id!: string;
  company_id!: string;
  customer_id!: string;
  invoice_number!: string | null;
  invoice_type!: InvoiceType | null;
  invoice_date!: string;
  due_date!: string | null;
  payment_terms!: PaymentTermsType;
  custom_days!: number | null;
  status!: InvoiceStatus;
  subtotal!: number;
  vat_total!: number;
  grand_total!: number;
  amount_paid!: number;
  source_quotation_id!: string | null;
  journal_entry_id!: string | null;
  void_reason!: string | null;
  created_by!: string;
  created_at!: string;
  updated_at!: string;
}
