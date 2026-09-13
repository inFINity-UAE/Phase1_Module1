import { SupplierPaymentApplication } from './supplier-payment-application.entity';
import { SupplierPayment } from './supplier-payment.entity';

export class SupplierPaymentWithApplications {
  payment!: SupplierPayment;
  applications!: SupplierPaymentApplication[];
}
