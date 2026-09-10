import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { PaymentApplication } from './entities/payment-application.entity';
import { PaymentWithApplications } from './entities/payment-with-applications.entity';
import { Payment } from './entities/payment.entity';

export const PAYMENTS_REPOSITORY = Symbol('PAYMENTS_REPOSITORY');

export interface InsertPaymentParams extends Omit<CreatePaymentDto, 'applications'> {
  created_by: string;
}

export interface PaymentsRepository {
  insertPayment(params: InsertPaymentParams): Promise<Payment>;
  findAll(companyId: string): Promise<Payment[]>;
  findByIdWithApplications(id: string): Promise<PaymentWithApplications | null>;
  updatePayment(id: string, patch: UpdatePaymentDto): Promise<Payment>;
  deletePayment(id: string): Promise<void>;
  insertApplication(params: {
    payment_id: string;
    invoice_id: string;
    applied_amount: number;
    applied_by: string;
  }): Promise<PaymentApplication>;
  deleteApplication(id: string): Promise<void>;
  findApplicationById(id: string): Promise<PaymentApplication | null>;
  findPaymentIdByApplicationId(id: string): Promise<string | null>;
  findCustomerCompanyId(customerId: string): Promise<string | null>;
  findCustomerActive(customerId: string): Promise<boolean | null>;
  postPaymentJournal(paymentId: string, createdBy: string): Promise<{
    journal_entry_id: string;
    entry_type: string;
  }>;
  postAdvanceApplicationJournal(
    paymentApplicationId: string,
    createdBy: string,
  ): Promise<{ journal_entry_id: string }>;
}
