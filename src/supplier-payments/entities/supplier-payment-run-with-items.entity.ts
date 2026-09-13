import { SupplierPaymentRunItem } from './supplier-payment-run-item.entity';
import { SupplierPaymentRun } from './supplier-payment-run.entity';

export class SupplierPaymentRunWithItems {
  run!: SupplierPaymentRun;
  items!: SupplierPaymentRunItem[];
}
