import { PaymentMethodType } from '../../payments/common/enums/payment-method-type.enum';
import { PaymentRunStatus } from '../common/enums/payment-run-status.enum';

/** Row shape for `supplier_payment_runs` — [feature-spec-1_1_E.md §4.3]. */
export class SupplierPaymentRun {
  id!: string;
  company_id!: string;
  run_date!: string;
  payment_method!: PaymentMethodType;
  bank_account_id!: string | null;
  status!: PaymentRunStatus;
  created_by!: string;
  approved_by!: string | null;
  executed_at!: string | null;
  created_at!: string;
  updated_at!: string;
}
