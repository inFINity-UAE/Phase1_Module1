import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { handleDatabaseError } from '../common/errors/database-error.mapper';
import { CreatePaymentApplicationDto } from './dto/create-payment-application.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { PaymentApplication } from './entities/payment-application.entity';
import { PaymentWithApplications } from './entities/payment-with-applications.entity';
import { Payment } from './entities/payment.entity';
import { PAYMENTS_REPOSITORY, PaymentsRepository } from './payments.repository';

/**
 * [feature-spec-1_1_D.md §4.2 / §4.3 / D-1]
 * One payments table: zero applications = advance; applications = invoice receipt.
 */
@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PAYMENTS_REPOSITORY)
    private readonly paymentsRepository: PaymentsRepository,
  ) {}

  async create(dto: CreatePaymentDto, createdBy: string): Promise<PaymentWithApplications> {
    await this.assertCustomerUsable(dto.customer_id, dto.company_id);

    try {
      const payment = await this.paymentsRepository.insertPayment({
        company_id: dto.company_id,
        customer_id: dto.customer_id,
        payment_date: dto.payment_date,
        amount: dto.amount,
        payment_method: dto.payment_method,
        reference_number: dto.reference_number,
        bank_account_id: dto.bank_account_id,
        created_by: createdBy,
      });

      for (const app of dto.applications ?? []) {
        await this.paymentsRepository.insertApplication({
          payment_id: payment.id,
          invoice_id: app.invoice_id,
          applied_amount: app.applied_amount,
          applied_by: createdBy,
        });
      }

      return this.findOne(payment.id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findAll(companyId: string): Promise<Payment[]> {
    try {
      return await this.paymentsRepository.findAll(companyId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findOne(id: string): Promise<PaymentWithApplications> {
    try {
      const row = await this.paymentsRepository.findByIdWithApplications(id);
      if (!row) throw new NotFoundException(`Payment ${id} not found`);
      return row;
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async update(id: string, dto: UpdatePaymentDto): Promise<PaymentWithApplications> {
    const current = await this.findOne(id);
    this.assertNotPosted(current.payment, 'update');

    try {
      await this.paymentsRepository.updatePayment(id, dto);
      return this.findOne(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async remove(id: string): Promise<void> {
    const current = await this.findOne(id);
    this.assertNotPosted(current.payment, 'delete');

    try {
      await this.paymentsRepository.deletePayment(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /** [§4.2 / §4.3 / D-1] Posts customer_payment or advance_receipt by application state. */
  async post(id: string, createdBy: string): Promise<PaymentWithApplications> {
    await this.findOne(id);

    try {
      await this.paymentsRepository.postPaymentJournal(id, createdBy);
      return this.findOne(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async createApplication(
    dto: CreatePaymentApplicationDto,
    appliedBy: string,
  ): Promise<PaymentApplication> {
    await this.findOne(dto.payment_id);

    try {
      return await this.paymentsRepository.insertApplication({
        payment_id: dto.payment_id,
        invoice_id: dto.invoice_id,
        applied_amount: dto.applied_amount,
        applied_by: appliedBy,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async deleteApplication(id: string): Promise<void> {
    const paymentId = await this.paymentsRepository.findPaymentIdByApplicationId(id);
    if (!paymentId) throw new NotFoundException(`Payment application ${id} not found`);

    try {
      await this.paymentsRepository.deleteApplication(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /** [§4.3] Cash-free reclass after applying an advance to an invoice. */
  async postAdvanceApplication(
    applicationId: string,
    createdBy: string,
  ): Promise<{ application: PaymentApplication; journal_entry_id: string }> {
    const application = await this.paymentsRepository.findApplicationById(applicationId);
    if (!application) throw new NotFoundException(`Payment application ${applicationId} not found`);

    try {
      const posted = await this.paymentsRepository.postAdvanceApplicationJournal(
        applicationId,
        createdBy,
      );
      return { application, journal_entry_id: posted.journal_entry_id };
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  private assertNotPosted(payment: Payment, action: string): void {
    if (payment.journal_entry_id != null) {
      throw new BadRequestException(
        `Cannot ${action} payment ${payment.id} — journal already posted`,
      );
    }
  }

  private async assertCustomerUsable(customerId: string, companyId: string): Promise<void> {
    const customerCompanyId = await this.paymentsRepository.findCustomerCompanyId(customerId);
    if (customerCompanyId == null) throw new NotFoundException(`Customer ${customerId} not found`);
    if (customerCompanyId !== companyId) {
      throw new BadRequestException('Customer does not belong to this company');
    }
    const active = await this.paymentsRepository.findCustomerActive(customerId);
    if (active === false) throw new BadRequestException('Customer is inactive');
  }
}
