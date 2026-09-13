import { CreateSupplierPaymentRunItemDto } from './dto/create-supplier-payment-run.dto';
import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto';
import { CreateSupplierStatementLineDto } from './dto/create-supplier-statement-line.dto';
import { UpdateSupplierPaymentDto } from './dto/update-supplier-payment.dto';
import { UpdateSupplierStatementLineDto } from './dto/update-supplier-statement-line.dto';
import { SupplierPaymentApplication } from './entities/supplier-payment-application.entity';
import { SupplierPaymentRunItem } from './entities/supplier-payment-run-item.entity';
import { SupplierPaymentRunWithItems } from './entities/supplier-payment-run-with-items.entity';
import { SupplierPaymentRun } from './entities/supplier-payment-run.entity';
import { SupplierPaymentWithApplications } from './entities/supplier-payment-with-applications.entity';
import { SupplierPayment } from './entities/supplier-payment.entity';
import { SupplierStatementLine } from './entities/supplier-statement-line.entity';

export const SUPPLIER_PAYMENTS_REPOSITORY = Symbol('SUPPLIER_PAYMENTS_REPOSITORY');

export interface InsertSupplierPaymentParams extends Omit<CreateSupplierPaymentDto, 'applications'> {
  created_by: string;
}

export interface SupplierPaymentsRepository {
  insertPayment(params: InsertSupplierPaymentParams): Promise<SupplierPayment>;
  findAllPayments(companyId: string): Promise<SupplierPayment[]>;
  findPaymentByIdWithApplications(id: string): Promise<SupplierPaymentWithApplications | null>;
  updatePayment(id: string, patch: UpdateSupplierPaymentDto): Promise<SupplierPayment>;
  deletePayment(id: string): Promise<void>;
  insertApplication(params: {
    supplier_payment_id: string;
    bill_id: string;
    applied_amount: number;
    applied_by: string;
  }): Promise<SupplierPaymentApplication>;
  deleteApplication(id: string): Promise<void>;
  findApplicationById(id: string): Promise<SupplierPaymentApplication | null>;
  findSupplierCompanyId(supplierId: string): Promise<string | null>;
  findSupplierActive(supplierId: string): Promise<boolean | null>;
  postPaymentJournal(paymentId: string, createdBy: string): Promise<{ journal_entry_id: string }>;
  postAdvanceApplicationJournal(
    applicationId: string,
    createdBy: string,
  ): Promise<{ journal_entry_id: string }>;

  insertRun(params: {
    company_id: string;
    run_date: string;
    payment_method: string;
    bank_account_id?: string | null;
    created_by: string;
  }): Promise<SupplierPaymentRun>;
  insertRunItem(
    runId: string,
    item: CreateSupplierPaymentRunItemDto,
  ): Promise<SupplierPaymentRunItem>;
  findAllRuns(companyId: string): Promise<SupplierPaymentRun[]>;
  findRunByIdWithItems(id: string): Promise<SupplierPaymentRunWithItems | null>;
  updateRun(
    id: string,
    patch: Partial<
      Pick<
        SupplierPaymentRun,
        'status' | 'approved_by' | 'executed_at' | 'run_date' | 'payment_method' | 'bank_account_id'
      >
    >,
  ): Promise<SupplierPaymentRun>;
  deleteRun(id: string): Promise<void>;
  executeRun(runId: string, createdBy: string): Promise<unknown>;

  insertStatementLine(dto: CreateSupplierStatementLineDto): Promise<SupplierStatementLine>;
  findAllStatementLines(companyId: string): Promise<SupplierStatementLine[]>;
  findStatementLineById(id: string): Promise<SupplierStatementLine | null>;
  updateStatementLine(
    id: string,
    patch: UpdateSupplierStatementLineDto,
  ): Promise<SupplierStatementLine>;
  confirmStatementMatch(
    id: string,
    patch: {
      matched_bill_id?: string | null;
      matched_payment_id?: string | null;
      match_status: string;
    },
  ): Promise<SupplierStatementLine>;
  deleteStatementLine(id: string): Promise<void>;
}
