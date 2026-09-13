import { PaymentTermsType } from '../../invoices/common/enums/payment-terms-type.enum';
import { BillMatchStatus } from '../common/enums/bill-match-status.enum';
import { BillStatus } from '../common/enums/bill-status.enum';

/** Row shape for `bills` — [feature-spec-1_1_E.md §3.2]. */
export class Bill {
  id!: string;
  company_id!: string;
  supplier_id!: string;
  bill_number!: string | null;
  supplier_invoice_number!: string | null;
  purchase_order_id!: string | null;
  bill_date!: string;
  due_date!: string | null;
  payment_terms!: PaymentTermsType;
  custom_days!: number | null;
  subtotal!: number;
  vat_total!: number;
  grand_total!: number;
  amount_paid!: number;
  paid_at!: string | null;
  status!: BillStatus;
  match_status!: BillMatchStatus | null;
  possible_duplicate_of!: string | null;
  scheduled_payment_date!: string | null;
  journal_entry_id!: string | null;
  payment_match_override_reason!: string | null;
  payment_match_overridden_by!: string | null;
  payment_match_overridden_at!: string | null;
  void_reason!: string | null;
  created_by!: string;
  created_at!: string;
  updated_at!: string;
}
