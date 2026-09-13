import { PaymentMethodType } from '../../payments/common/enums/payment-method-type.enum';

/** Row shape for `supplier_payments` — [feature-spec-1_1_E.md §3.5]. */
export class SupplierPayment {
  id!: string;
  company_id!: string;
  supplier_id!: string;
  payment_date!: string;
  amount!: number;
  payment_method!: PaymentMethodType | null;
  reference_number!: string | null;
  bank_account_id!: string | null;
  unapplied_amount!: number;
  journal_entry_id!: string | null;
  payment_run_id!: string | null;
  created_by!: string;
  created_at!: string;
  updated_at!: string;
}
