import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { handleDatabaseError } from '../common/errors/database-error.mapper';
import { CompanyRole } from '../common/enums/company-role.enum';
import { PaymentRunStatus } from './common/enums/payment-run-status.enum';
import { ConfirmSupplierStatementMatchDto } from './dto/confirm-supplier-statement-match.dto';
import { CreateSupplierPaymentApplicationDto } from './dto/create-supplier-payment-application.dto';
import { CreateSupplierPaymentRunDto } from './dto/create-supplier-payment-run.dto';
import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto';
import { CreateSupplierStatementLineDto } from './dto/create-supplier-statement-line.dto';
import { UpdateSupplierPaymentDto } from './dto/update-supplier-payment.dto';
import { UpdateSupplierPaymentRunDto } from './dto/update-supplier-payment-run.dto';
import { UpdateSupplierStatementLineDto } from './dto/update-supplier-statement-line.dto';
import { SupplierPaymentApplication } from './entities/supplier-payment-application.entity';
import { SupplierPaymentRunWithItems } from './entities/supplier-payment-run-with-items.entity';
import { SupplierPaymentRun } from './entities/supplier-payment-run.entity';
import { SupplierPaymentWithApplications } from './entities/supplier-payment-with-applications.entity';
import { SupplierPayment } from './entities/supplier-payment.entity';
import { SupplierStatementLine } from './entities/supplier-statement-line.entity';
import {
  SUPPLIER_PAYMENTS_REPOSITORY,
  SupplierPaymentsRepository,
} from './supplier-payments.repository';

@Injectable()
export class SupplierPaymentsService {
  constructor(
    @Inject(SUPPLIER_PAYMENTS_REPOSITORY)
    private readonly repo: SupplierPaymentsRepository,
  ) {}

  async createPayment(
    dto: CreateSupplierPaymentDto,
    createdBy: string,
  ): Promise<SupplierPaymentWithApplications> {
    await this.assertSupplierUsable(dto.supplier_id, dto.company_id);
    try {
      const payment = await this.repo.insertPayment({
        company_id: dto.company_id,
        supplier_id: dto.supplier_id,
        payment_date: dto.payment_date,
        amount: dto.amount,
        payment_method: dto.payment_method,
        reference_number: dto.reference_number,
        bank_account_id: dto.bank_account_id,
        created_by: createdBy,
      });
      for (const app of dto.applications ?? []) {
        await this.repo.insertApplication({
          supplier_payment_id: payment.id,
          bill_id: app.bill_id,
          applied_amount: app.applied_amount,
          applied_by: createdBy,
        });
      }
      return this.findPayment(payment.id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findAllPayments(companyId: string): Promise<SupplierPayment[]> {
    try {
      return await this.repo.findAllPayments(companyId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findPayment(id: string): Promise<SupplierPaymentWithApplications> {
    try {
      const row = await this.repo.findPaymentByIdWithApplications(id);
      if (!row) throw new NotFoundException(`Supplier payment ${id} not found`);
      return row;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      handleDatabaseError(error);
    }
  }

  async updatePayment(id: string, dto: UpdateSupplierPaymentDto): Promise<SupplierPaymentWithApplications> {
    const current = await this.findPayment(id);
    this.assertPaymentNotPosted(current.payment, 'update');
    try {
      await this.repo.updatePayment(id, dto);
      return this.findPayment(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async removePayment(id: string): Promise<void> {
    const current = await this.findPayment(id);
    this.assertPaymentNotPosted(current.payment, 'delete');
    try {
      await this.repo.deletePayment(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async postPayment(id: string, createdBy: string): Promise<SupplierPaymentWithApplications> {
    await this.findPayment(id);
    try {
      await this.repo.postPaymentJournal(id, createdBy);
      return this.findPayment(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async createApplication(
    paymentId: string,
    dto: CreateSupplierPaymentApplicationDto,
    appliedBy: string,
  ): Promise<SupplierPaymentApplication> {
    await this.findPayment(paymentId);
    try {
      return await this.repo.insertApplication({
        supplier_payment_id: paymentId,
        bill_id: dto.bill_id,
        applied_amount: dto.applied_amount,
        applied_by: appliedBy,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async deleteApplication(paymentId: string, applicationId: string): Promise<void> {
    await this.findPayment(paymentId);
    const application = await this.repo.findApplicationById(applicationId);
    if (!application || application.supplier_payment_id !== paymentId) {
      throw new NotFoundException(
        `Application ${applicationId} not found on supplier payment ${paymentId}`,
      );
    }
    if (application.journal_entry_id != null) {
      throw new BadRequestException('Cannot delete an application after its journal is posted');
    }
    try {
      await this.repo.deleteApplication(applicationId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /** [feature-spec-1_1_E.md §4.5] Cash-free reclass Dr 2000 / Cr 1350. */
  async postAdvanceApplication(
    paymentId: string,
    applicationId: string,
    createdBy: string,
  ): Promise<{ application: SupplierPaymentApplication; journal_entry_id: string }> {
    await this.findPayment(paymentId);
    const application = await this.repo.findApplicationById(applicationId);
    if (!application || application.supplier_payment_id !== paymentId) {
      throw new NotFoundException(
        `Application ${applicationId} not found on supplier payment ${paymentId}`,
      );
    }
    try {
      const posted = await this.repo.postAdvanceApplicationJournal(applicationId, createdBy);
      const refreshed = await this.repo.findApplicationById(applicationId);
      if (!refreshed) {
        throw new NotFoundException(
          `Application ${applicationId} not found on supplier payment ${paymentId}`,
        );
      }
      return { application: refreshed, journal_entry_id: posted.journal_entry_id };
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async createRun(
    dto: CreateSupplierPaymentRunDto,
    createdBy: string,
  ): Promise<SupplierPaymentRunWithItems> {
    try {
      const run = await this.repo.insertRun({
        company_id: dto.company_id,
        run_date: dto.run_date,
        payment_method: dto.payment_method,
        bank_account_id: dto.bank_account_id,
        created_by: createdBy,
      });
      for (const item of dto.items) {
        await this.repo.insertRunItem(run.id, item);
      }
      return this.findRun(run.id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findAllRuns(companyId: string): Promise<SupplierPaymentRun[]> {
    try {
      return await this.repo.findAllRuns(companyId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findRun(id: string): Promise<SupplierPaymentRunWithItems> {
    try {
      const row = await this.repo.findRunByIdWithItems(id);
      if (!row) throw new NotFoundException(`Payment run ${id} not found`);
      return row;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      handleDatabaseError(error);
    }
  }

  /** [feature-spec-1_1_E.md §4.3 / E-28] Operational approve — not a 50k money gate. */
  async approveRun(
    id: string,
    userId: string,
    role?: CompanyRole,
  ): Promise<SupplierPaymentRunWithItems> {
    const current = await this.findRun(id);
    if (current.run.status !== PaymentRunStatus.Draft) {
      throw new BadRequestException(`Cannot approve payment run from status ${current.run.status}`);
    }
    if (role !== CompanyRole.Owner && role !== CompanyRole.Manager) {
      throw new ForbiddenException('Only Owner or Manager can approve a payment run');
    }
    try {
      await this.repo.updateRun(id, {
        status: PaymentRunStatus.Approved,
        approved_by: userId,
      });
      return this.findRun(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async updateRunHeader(
    id: string,
    dto: UpdateSupplierPaymentRunDto,
  ): Promise<SupplierPaymentRunWithItems> {
    const current = await this.findRun(id);
    if (current.run.status !== PaymentRunStatus.Draft) {
      throw new BadRequestException(
        `Cannot update payment run from status ${current.run.status}`,
      );
    }
    try {
      await this.repo.updateRun(id, dto);
      return this.findRun(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async cancelRun(id: string): Promise<SupplierPaymentRunWithItems> {
    const current = await this.findRun(id);
    if (current.run.status !== PaymentRunStatus.Draft) {
      throw new BadRequestException(
        `Cannot cancel payment run from status ${current.run.status}`,
      );
    }
    try {
      await this.repo.updateRun(id, { status: PaymentRunStatus.Cancelled });
      return this.findRun(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async executeRun(id: string, createdBy: string): Promise<unknown> {
    const current = await this.findRun(id);
    if (current.run.status !== PaymentRunStatus.Approved) {
      throw new BadRequestException(`Cannot execute payment run from status ${current.run.status}`);
    }
    try {
      return await this.repo.executeRun(id, createdBy);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async removeRun(id: string): Promise<void> {
    const current = await this.findRun(id);
    if (current.run.status !== PaymentRunStatus.Draft) {
      throw new BadRequestException(`Cannot delete payment run from status ${current.run.status}`);
    }
    try {
      await this.repo.deleteRun(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async createStatementLine(dto: CreateSupplierStatementLineDto): Promise<SupplierStatementLine> {
    try {
      return await this.repo.insertStatementLine(dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findAllStatementLines(companyId: string): Promise<SupplierStatementLine[]> {
    try {
      return await this.repo.findAllStatementLines(companyId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findStatementLine(id: string): Promise<SupplierStatementLine> {
    try {
      const row = await this.repo.findStatementLineById(id);
      if (!row) throw new NotFoundException(`Supplier statement line ${id} not found`);
      return row;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      handleDatabaseError(error);
    }
  }

  async updateStatementLine(
    id: string,
    dto: UpdateSupplierStatementLineDto,
  ): Promise<SupplierStatementLine> {
    await this.findStatementLine(id);
    const hasPatch =
      dto.statement_date !== undefined ||
      dto.line_date !== undefined ||
      dto.line_type !== undefined ||
      dto.reference !== undefined ||
      dto.amount !== undefined ||
      dto.source !== undefined;
    if (!hasPatch) throw new BadRequestException('No updatable fields provided');
    try {
      return await this.repo.updateStatementLine(id, dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async confirmStatementMatch(
    id: string,
    dto: ConfirmSupplierStatementMatchDto,
  ): Promise<SupplierStatementLine> {
    await this.findStatementLine(id);
    if (!dto.matched_bill_id && !dto.matched_payment_id) {
      throw new BadRequestException('matched_bill_id or matched_payment_id is required');
    }
    try {
      return await this.repo.confirmStatementMatch(id, {
        matched_bill_id: dto.matched_bill_id ?? null,
        matched_payment_id: dto.matched_payment_id ?? null,
        match_status: 'matched',
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async removeStatementLine(id: string): Promise<void> {
    await this.findStatementLine(id);
    try {
      await this.repo.deleteStatementLine(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  private assertPaymentNotPosted(payment: SupplierPayment, action: string): void {
    if (payment.journal_entry_id != null) {
      throw new BadRequestException(
        `Cannot ${action} supplier payment ${payment.id} — journal already posted`,
      );
    }
  }

  private async assertSupplierUsable(supplierId: string, companyId: string): Promise<void> {
    const supplierCompanyId = await this.repo.findSupplierCompanyId(supplierId);
    if (!supplierCompanyId) throw new NotFoundException(`Supplier ${supplierId} not found`);
    if (supplierCompanyId !== companyId) {
      throw new BadRequestException('Supplier does not belong to this company');
    }
    const active = await this.repo.findSupplierActive(supplierId);
    if (!active) {
      throw new BadRequestException(
        `Supplier ${supplierId} is inactive — cannot record payments`,
      );
    }
  }
}
