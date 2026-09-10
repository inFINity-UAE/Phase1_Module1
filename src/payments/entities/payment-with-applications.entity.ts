import { PaymentApplication } from './payment-application.entity';
import { Payment } from './payment.entity';

export class PaymentWithApplications {
  payment!: Payment;
  applications!: PaymentApplication[];
}
