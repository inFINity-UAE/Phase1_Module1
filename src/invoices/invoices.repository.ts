import { CreateInvoiceLineDto } from './dto/create-invoice-line.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceLineDto } from './dto/update-invoice-line.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { InvoiceType } from './common/enums/invoice-type.enum';
import { InvoiceLine } from './entities/invoice-line.entity';
import { InvoiceWithLines } from './entities/invoice-with-lines.entity';
import { Invoice } from './entities/invoice.entity';
import { InvoiceStatus } from './common/enums/invoice-status.enum';

export const INVOICES_REPOSITORY = Symbol('INVOICES_REPOSITORY');

export interface InsertInvoiceParams extends CreateInvoiceDto {
  created_by: string;
}

export interface InvoicesRepository {
  insertHeader(params: InsertInvoiceParams): Promise<Invoice>;
  findAll(companyId: string): Promise<Invoice[]>;
  findByIdWithLines(id: string): Promise<InvoiceWithLines | null>;
  updateHeader(id: string, patch: UpdateInvoiceDto): Promise<Invoice>;
  updateStatus(id: string, status: InvoiceStatus, voidReason?: string): Promise<Invoice>;
  deleteHeader(id: string): Promise<void>;
  insertLine(invoiceId: string, dto: CreateInvoiceLineDto): Promise<InvoiceLine>;
  updateLine(id: string, dto: UpdateInvoiceLineDto): Promise<InvoiceLine>;
  deleteLine(id: string): Promise<void>;
  findInvoiceIdByLineId(lineId: string): Promise<string | null>;
  findCustomerActive(customerId: string): Promise<boolean | null>;
  findCustomerCompanyId(customerId: string): Promise<string | null>;
  issueInvoice(id: string, invoiceTypeOverride?: InvoiceType | null): Promise<Invoice>;
  voidInvoice(
    id: string,
    voidReason: string,
    createdBy: string,
  ): Promise<{
    invoice: Invoice;
    ledger_reversal_status: 'reversed' | 'skipped_no_posting';
  }>;
}
