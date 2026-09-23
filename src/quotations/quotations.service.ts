import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { handleDatabaseError } from '../common/errors/database-error.mapper';
import { QuotationStatus } from './common/enums/quotation-status.enum';
import { CreateQuotationLineDto } from './dto/create-quotation-line.dto';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationLineDto } from './dto/update-quotation-line.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { QuotationWithLines } from './entities/quotation-with-lines.entity';
import { QuotationLine } from './entities/quotation-line.entity';
import { Quotation } from './entities/quotation.entity';
import { InvoiceWithLines } from '../invoices/entities/invoice-with-lines.entity';
import { InvoicesService } from '../invoices/invoices.service';
import {
  QUOTATIONS_REPOSITORY,
  QuotationsRepository,
} from './quotations.repository';

const STATUS_TRANSITIONS: Record<QuotationStatus, QuotationStatus[]> = {
  [QuotationStatus.Draft]: [QuotationStatus.Sent],
  [QuotationStatus.Sent]: [QuotationStatus.Viewed],
  [QuotationStatus.Viewed]: [QuotationStatus.Accepted, QuotationStatus.Declined],
  [QuotationStatus.Accepted]: [],
  [QuotationStatus.Declined]: [],
  [QuotationStatus.Expired]: [],
};

@Injectable()
export class QuotationsService {
  constructor(
    @Inject(QUOTATIONS_REPOSITORY)
    private readonly quotationsRepository: QuotationsRepository,
    private readonly invoicesService: InvoicesService,
  ) {}

  async create(dto: CreateQuotationDto, createdBy: string): Promise<QuotationWithLines> {
    await this.assertCustomerUsable(dto.customer_id, dto.company_id);

    try {
      const quotation = await this.quotationsRepository.insertHeader({
        ...dto,
        created_by: createdBy,
      });

      for (const line of dto.lines ?? []) {
        await this.quotationsRepository.insertLine(quotation.id, line);
      }

      return this.findOne(quotation.id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findAll(companyId: string): Promise<Quotation[]> {
    try {
      return await this.quotationsRepository.findAll(companyId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findOne(id: string): Promise<QuotationWithLines> {
    try {
      const result = await this.quotationsRepository.findByIdWithLines(id);
      if (!result) {
        throw new NotFoundException(`Quotation ${id} not found`);
      }
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      handleDatabaseError(error);
    }
  }

  async update(id: string, dto: UpdateQuotationDto): Promise<QuotationWithLines> {
    const current = await this.findOne(id);
    this.assertDraft(current.quotation, 'update');

    if (dto.customer_id && dto.customer_id !== current.quotation.customer_id) {
      await this.assertCustomerUsable(dto.customer_id, current.quotation.company_id);
    }

    const hasPatch =
      dto.customer_id !== undefined ||
      dto.quotation_date !== undefined ||
      dto.valid_until !== undefined ||
      dto.notes !== undefined;
    if (!hasPatch) {
      throw new BadRequestException('No updatable fields provided');
    }

    try {
      await this.quotationsRepository.updateHeader(id, dto);
      return this.findOne(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async remove(id: string): Promise<void> {
    const current = await this.findOne(id);
    this.assertDraft(current.quotation, 'delete');
    try {
      await this.quotationsRepository.deleteHeader(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async send(id: string): Promise<QuotationWithLines> {
    return this.transition(id, QuotationStatus.Sent);
  }

  async markViewed(id: string): Promise<QuotationWithLines> {
    return this.transition(id, QuotationStatus.Viewed);
  }

  async accept(id: string): Promise<QuotationWithLines> {
    return this.transition(id, QuotationStatus.Accepted);
  }

  async decline(id: string): Promise<QuotationWithLines> {
    return this.transition(id, QuotationStatus.Declined);
  }

  /** [feature-spec-1_1_C.md §4 decision #9] Accepted quotation → Draft invoice via RPC. */
  async convert(id: string, createdBy: string): Promise<InvoiceWithLines> {
    await this.findOne(id);

    try {
      const invoiceId = await this.quotationsRepository.convertToInvoice(id, createdBy);
      return this.invoicesService.findOne(invoiceId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async createLine(dto: CreateQuotationLineDto & { quotation_id: string }): Promise<QuotationLine> {
    const current = await this.findOne(dto.quotation_id);
    this.assertDraft(current.quotation, 'add lines to');

    try {
      return await this.quotationsRepository.insertLine(dto.quotation_id, dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async updateLine(id: string, dto: UpdateQuotationLineDto): Promise<QuotationLine> {
    const quotationId = await this.requireQuotationIdForLine(id);
    const current = await this.findOne(quotationId);
    this.assertDraft(current.quotation, 'update lines on');

    try {
      return await this.quotationsRepository.updateLine(id, dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async deleteLine(id: string): Promise<void> {
    const quotationId = await this.requireQuotationIdForLine(id);
    const current = await this.findOne(quotationId);
    this.assertDraft(current.quotation, 'delete lines from');

    try {
      await this.quotationsRepository.deleteLine(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  private async transition(id: string, target: QuotationStatus): Promise<QuotationWithLines> {
    const current = await this.findOne(id);
    const allowed = STATUS_TRANSITIONS[current.quotation.status] ?? [];
    if (!allowed.includes(target)) {
      throw new BadRequestException(
        `Cannot transition quotation from ${current.quotation.status} to ${target}`,
      );
    }

    try {
      await this.quotationsRepository.updateStatus(id, target);
      return this.findOne(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  private assertDraft(quotation: Quotation, action: string): void {
    if (quotation.status !== QuotationStatus.Draft) {
      throw new BadRequestException(
        `Cannot ${action} quotation ${quotation.quotation_number} — status is ${quotation.status}`,
      );
    }
  }

  private async assertCustomerUsable(customerId: string, companyId: string): Promise<void> {
    const customerCompanyId =
      await this.quotationsRepository.findCustomerCompanyId(customerId);
    if (!customerCompanyId) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }
    if (customerCompanyId !== companyId) {
      throw new BadRequestException(`Customer ${customerId} does not belong to this company`);
    }

    const isActive = await this.quotationsRepository.findCustomerActive(customerId);
    if (!isActive) {
      throw new BadRequestException(
        `Customer ${customerId} is inactive — cannot create or assign quotations`,
      );
    }
  }

  private async requireQuotationIdForLine(lineId: string): Promise<string> {
    const quotationId = await this.quotationsRepository.findQuotationIdByLineId(lineId);
    if (!quotationId) {
      throw new NotFoundException(`Quotation line ${lineId} not found`);
    }
    return quotationId;
  }
}
