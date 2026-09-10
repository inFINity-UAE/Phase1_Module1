import { PaymentMethodType } from '../common/enums/payment-method-type.enum';

/** Row shape for `payments` — [feature-spec-1_1_D.md §3.2]. */
export class Payment {
  id!: string;
  company_id!: string;
  customer_id!: string;
  payment_date!: string;
  amount!: number;
  payment_method!: PaymentMethodType | null;
  reference_number!: string | null;
  bank_account_id!: string | null;
  unapplied_amount!: number;
  journal_entry_id!: string | null;
  created_by!: string;
  created_at!: string;
  updated_at!: string;
}
