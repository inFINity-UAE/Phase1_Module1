import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { handleDatabaseError } from '../common/errors/database-error.mapper';
import { CompanyRole } from '../common/enums/company-role.enum';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { ReportsService } from '../reports/reports.service';
import { InvoiceStatus } from './common/enums/invoice-status.enum';
import { InvoiceType } from './common/enums/invoice-type.enum';
import { PaymentTermsType } from './common/enums/payment-terms-type.enum';
import { CreateInvoiceLineDto } from './dto/create-invoice-line.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { IssueInvoiceDto } from './dto/issue-invoice.dto';
import { UpdateInvoiceLineDto } from './dto/update-invoice-line.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { VoidInvoiceDto } from './dto/void-invoice.dto';
import { WriteOffInvoiceDto } from './dto/write-off-invoice.dto';
import { SetDebtorNotifiedDto } from './dto/set-debtor-notified.dto';
import { InvoiceIssueResult, InvoiceVoidResult } from './entities/invoice-with-lines.entity';
import { InvoiceLine } from './entities/invoice-line.entity';
import { InvoiceWithLines } from './entities/invoice-with-lines.entity';
import { Invoice } from './entities/invoice.entity';
import { INVOICES_REPOSITORY, InvoicesRepository } from './invoices.repository';

const STATUS_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  [InvoiceStatus.Draft]: [InvoiceStatus.Issued],
  [InvoiceStatus.Issued]: [InvoiceStatus.Sent, InvoiceStatus.Void, InvoiceStatus.WrittenOff],
  [InvoiceStatus.Sent]: [InvoiceStatus.Viewed, InvoiceStatus.Void],
  [InvoiceStatus.Viewed]: [InvoiceStatus.Void],
  [InvoiceStatus.PartiallyPaid]: [InvoiceStatus.WrittenOff],
  [InvoiceStatus.Paid]: [],
  [InvoiceStatus.Overdue]: [InvoiceStatus.Void, InvoiceStatus.WrittenOff],
  [InvoiceStatus.WrittenOff]: [],
  [InvoiceStatus.Void]: [],
};

@Injectable()
export class InvoicesService {
  constructor(
    @Inject(INVOICES_REPOSITORY)
    private readonly invoicesRepository: InvoicesRepository,
    private readonly journalEntriesService: JournalEntriesService,
    private readonly reportsService: ReportsService,
  ) {}

  async create(dto: CreateInvoiceDto, createdBy: string): Promise<InvoiceWithLines> {
    await this.assertCustomerUsable(dto.customer_id, dto.company_id);
    this.assertCustomDaysWhenRequired(dto.payment_terms, dto.custom_days);

    try {
      const invoice = await this.invoicesRepository.insertHeader({
        ...dto,
        created_by: createdBy,
      });

      for (const line of dto.lines ?? []) {
        await this.invoicesRepository.insertLine(invoice.id, line);
      }

      return this.findOne(invoice.id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findAll(companyId: string): Promise<Invoice[]> {
    try {
      return await this.invoicesRepository.findAll(companyId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findOne(id: string): Promise<InvoiceWithLines> {
    try {
      const result = await this.invoicesRepository.findByIdWithLines(id);
      if (!result) {
        throw new NotFoundException(`Invoice ${id} not found`);
      }
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      handleDatabaseError(error);
    }
  }

  async update(id: string, dto: UpdateInvoiceDto): Promise<InvoiceWithLines> {
    const current = await this.findOne(id);
    this.assertDraft(current.invoice, 'update');

    if (dto.customer_id && dto.customer_id !== current.invoice.customer_id) {
      await this.assertCustomerUsable(dto.customer_id, current.invoice.company_id);
    }

    const paymentTerms = dto.payment_terms ?? current.invoice.payment_terms;
    const customDays =
      dto.custom_days !== undefined ? dto.custom_days : current.invoice.custom_days;
    this.assertCustomDaysWhenRequired(paymentTerms, customDays);

    const hasPatch =
      dto.customer_id !== undefined ||
      dto.invoice_date !== undefined ||
      dto.payment_terms !== undefined ||
      dto.custom_days !== undefined;
    if (!hasPatch) {
      throw new BadRequestException('No updatable fields provided');
    }

    try {
      await this.invoicesRepository.updateHeader(id, dto);
      return this.findOne(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async remove(id: string): Promise<void> {
    const current = await this.findOne(id);
    this.assertDraft(current.invoice, 'delete');
    try {
      await this.invoicesRepository.deleteHeader(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec-1.1.C.md §2.2 / §7] Draft → Issued: numbering, due_date,
   * invoice_type, and atomic sales-invoice ledger posting via issue_invoice RPC.
   * [feature-spec-1_1_D.md §5.3 / D-4] Credit-limit alert returned, never blocks.
   */
  async issue(id: string, dto?: IssueInvoiceDto): Promise<InvoiceIssueResult> {
    const current = await this.findOne(id);
    if (current.invoice.status !== InvoiceStatus.Draft) {
      throw new BadRequestException(
        `Cannot issue invoice — status is ${current.invoice.status}`,
      );
    }

    if (dto?.invoice_type_override && dto.invoice_type_override !== InvoiceType.TaxInvoice) {
      throw new BadRequestException(
        'invoice_type_override may only force tax_invoice when permitted',
      );
    }

    try {
      await this.invoicesRepository.issueInvoice(
        id,
        dto?.invoice_type_override ?? null,
      );
      const issued = await this.findOne(id);
      const credit_limit_check = await this.reportsService.checkCustomerCreditLimit(
        issued.invoice.company_id,
        issued.invoice.customer_id,
      );
      return { ...issued, credit_limit_check };
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec-1.1.C.md §2.2 / §7] Void requires void_reason and atomically
   * reverses journal_entry_id via void_invoice RPC when posting exists.
   */
  async void(id: string, dto: VoidInvoiceDto, createdBy: string): Promise<InvoiceVoidResult> {
    const current = await this.findOne(id);
    const allowed = STATUS_TRANSITIONS[current.invoice.status] ?? [];
    if (!allowed.includes(InvoiceStatus.Void)) {
      throw new BadRequestException(
        `Cannot void invoice from status ${current.invoice.status}`,
      );
    }

    if (!dto.void_reason?.trim()) {
      throw new BadRequestException('void_reason is required to void an invoice');
    }

    try {
      const { ledger_reversal_status } = await this.invoicesRepository.voidInvoice(
        id,
        dto.void_reason.trim(),
        createdBy,
      );
      const withLines = await this.findOne(id);
      return {
        ...withLines,
        ledger_reversal_status,
      };
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async send(id: string): Promise<InvoiceWithLines> {
    return this.transition(id, InvoiceStatus.Sent);
  }

  async markViewed(id: string): Promise<InvoiceWithLines> {
    return this.transition(id, InvoiceStatus.Viewed);
  }

  /**
   * [feature-spec-1_1_D.md §4.4 / D-8 / D-9 / D-11]
   * Creates write_offs + draft write_off JE, then posts via A's threshold path
   * (write_off_approval_threshold). Undo = reverse_journal_entry.
   */
  async writeOff(
    id: string,
    dto: WriteOffInvoiceDto,
    userId: string,
    role?: CompanyRole,
  ): Promise<InvoiceWithLines> {
    const current = await this.findOne(id);
    const allowed = STATUS_TRANSITIONS[current.invoice.status] ?? [];
    if (!allowed.includes(InvoiceStatus.WrittenOff)) {
      throw new BadRequestException(
        `Cannot transition invoice from ${current.invoice.status} to ${InvoiceStatus.WrittenOff}`,
      );
    }

    try {
      const result = await this.invoicesRepository.writeOffInvoice(
        id,
        userId,
        dto.reason,
        dto.debtor_notified_at ?? null,
      );
      await this.journalEntriesService.post(
        result.journal_entry_id,
        userId,
        {},
        role,
      );
      return this.findOne(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec-1_1_D.md §4.4] Follow-up: debtor notice can land after write-off.
   */
  async setDebtorNotified(
    id: string,
    dto: SetDebtorNotifiedDto,
  ): Promise<{ invoice_id: string; debtor_notified_at: string }> {
    const current = await this.findOne(id);
    if (current.invoice.status !== InvoiceStatus.WrittenOff) {
      throw new BadRequestException(
        `Invoice ${id} is not written off — cannot set debtor_notified_at`,
      );
    }

    try {
      const updated = await this.invoicesRepository.setDebtorNotifiedAt(
        id,
        dto.debtor_notified_at,
      );
      if (!updated) {
        throw new NotFoundException(`No write-off found for invoice ${id}`);
      }
      return { invoice_id: id, debtor_notified_at: dto.debtor_notified_at };
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async createLine(dto: CreateInvoiceLineDto & { invoice_id: string }): Promise<InvoiceLine> {
    const current = await this.findOne(dto.invoice_id);
    this.assertDraft(current.invoice, 'add lines to');

    try {
      return await this.invoicesRepository.insertLine(dto.invoice_id, dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async updateLine(id: string, dto: UpdateInvoiceLineDto): Promise<InvoiceLine> {
    const invoiceId = await this.requireInvoiceIdForLine(id);
    const current = await this.findOne(invoiceId);
    this.assertDraft(current.invoice, 'update lines on');

    try {
      return await this.invoicesRepository.updateLine(id, dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async deleteLine(id: string): Promise<void> {
    const invoiceId = await this.requireInvoiceIdForLine(id);
    const current = await this.findOne(invoiceId);
    this.assertDraft(current.invoice, 'delete lines from');

    try {
      await this.invoicesRepository.deleteLine(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  private async transition(id: string, target: InvoiceStatus): Promise<InvoiceWithLines> {
    const current = await this.findOne(id);
    const allowed = STATUS_TRANSITIONS[current.invoice.status] ?? [];
    if (!allowed.includes(target)) {
      throw new BadRequestException(
        `Cannot transition invoice from ${current.invoice.status} to ${target}`,
      );
    }

    try {
      await this.invoicesRepository.updateStatus(id, target);
      return this.findOne(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  private assertDraft(invoice: Invoice, action: string): void {
    if (invoice.status !== InvoiceStatus.Draft) {
      throw new BadRequestException(
        `Cannot ${action} invoice ${invoice.invoice_number ?? invoice.id} — status is ${invoice.status}`,
      );
    }
  }

  private assertCustomDaysWhenRequired(
    paymentTerms: PaymentTermsType | undefined,
    customDays: number | null | undefined,
  ): void {
    if (paymentTerms === PaymentTermsType.Custom && (customDays == null || customDays < 1)) {
      throw new BadRequestException('custom_days is required when payment_terms is custom');
    }
  }

  private async assertCustomerUsable(customerId: string, companyId: string): Promise<void> {
    const customerCompanyId = await this.invoicesRepository.findCustomerCompanyId(customerId);
    if (!customerCompanyId) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }
    if (customerCompanyId !== companyId) {
      throw new BadRequestException(`Customer ${customerId} does not belong to this company`);
    }

    const isActive = await this.invoicesRepository.findCustomerActive(customerId);
    if (!isActive) {
      throw new BadRequestException(
        `Customer ${customerId} is inactive — cannot create or assign invoices`,
      );
    }
  }

  private async requireInvoiceIdForLine(lineId: string): Promise<string> {
    const invoiceId = await this.invoicesRepository.findInvoiceIdByLineId(lineId);
    if (!invoiceId) {
      throw new NotFoundException(`Invoice line ${lineId} not found`);
    }
    return invoiceId;
  }
}
