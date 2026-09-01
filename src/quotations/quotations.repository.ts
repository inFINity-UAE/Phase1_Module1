import { CreateQuotationLineDto } from './dto/create-quotation-line.dto';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationLineDto } from './dto/update-quotation-line.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { QuotationLine } from './entities/quotation-line.entity';
import { QuotationWithLines } from './entities/quotation-with-lines.entity';
import { Quotation } from './entities/quotation.entity';
import { QuotationStatus } from './common/enums/quotation-status.enum';

export const QUOTATIONS_REPOSITORY = Symbol('QUOTATIONS_REPOSITORY');

export interface InsertQuotationParams extends CreateQuotationDto {
  created_by: string;
}

export interface QuotationsRepository {
  insertHeader(params: InsertQuotationParams): Promise<Quotation>;
  findAll(companyId: string): Promise<Quotation[]>;
  findByIdWithLines(id: string): Promise<QuotationWithLines | null>;
  updateHeader(id: string, patch: UpdateQuotationDto): Promise<Quotation>;
  updateStatus(id: string, status: QuotationStatus): Promise<Quotation>;
  deleteHeader(id: string): Promise<void>;
  insertLine(quotationId: string, dto: CreateQuotationLineDto): Promise<QuotationLine>;
  updateLine(id: string, dto: UpdateQuotationLineDto): Promise<QuotationLine>;
  deleteLine(id: string): Promise<void>;
  findQuotationIdByLineId(lineId: string): Promise<string | null>;
  findCustomerActive(customerId: string): Promise<boolean | null>;
  findCustomerCompanyId(customerId: string): Promise<string | null>;
  convertToInvoice(quotationId: string, createdBy: string): Promise<string>;
}
