import { PaymentTermsType } from '../../invoices/common/enums/payment-terms-type.enum';

/** Row shape for `suppliers` — [feature-spec-1_1_E.md §3.1]. */
export class Supplier {
  id!: string;
  company_id!: string;
  supplier_name!: string;
  trn!: string | null;
  email!: string | null;
  phone!: string | null;
  billing_address!: string | null;
  default_payment_terms!: PaymentTermsType;
  custom_days!: number | null;
  bank_name!: string | null;
  iban!: string | null;
  is_active!: boolean;
  created_at!: string;
  updated_at!: string;
}
