import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { IsPostgresUuid } from '../common/validators/is-postgres-uuid';
import { BillExtractionRepository } from './bill-extraction.repository';
import { DocumentIngestionService, UploadedDocument } from './document-ingestion.service';
import { DocumentPromotionService, isReviewQueueRow } from './document-promotion.service';
import { SnapshotLine } from './extraction-rules';

class IngestDocumentDto {
  @IsPostgresUuid()
  company_id!: string;
}

class RejectExtractionDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsString()
  @MinLength(1)
  reason!: string;
}

class ApproveExtractionDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsOptional()
  @IsPostgresUuid()
  supplier_id?: string;

  @IsOptional()
  @IsString()
  supplier_name?: string;

  @IsOptional()
  @IsString()
  invoice_number?: string;

  @IsOptional()
  @IsString()
  invoice_date?: string;

  @IsOptional()
  @IsPostgresUuid()
  account_id?: string;

  @IsOptional()
  @IsArray()
  lines?: SnapshotLine[];
}

class CompanyQueryDto {
  @IsPostgresUuid()
  company_id!: string;
}

/** [feature-spec-1_1_B.md §1–§3 / §5] Upload, review queue, approve, reject. */
@Controller('document-extractions')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class DocumentExtractionsController {
  constructor(
    private readonly ingestion: DocumentIngestionService,
    private readonly promotion: DocumentPromotionService,
    private readonly extractions: BillExtractionRepository,
  ) {}

  @Post()
  @RequireCompanyMembership({ type: 'body' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  ingest(
    @Body() dto: IngestDocumentDto,
    @UploadedFile() file: UploadedDocument,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ingestion.ingest(dto.company_id, user.id, file);
  }

  @Get()
  @RequireCompanyMembership({ type: 'query' })
  async queue(@Query() query: CompanyQueryDto) {
    const rows = await this.extractions.listForCompany(query.company_id);
    return rows.filter(isReviewQueueRow);
  }

  @Get(':id')
  @RequireCompanyMembership({ type: 'query' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Query() query: CompanyQueryDto) {
    return this.requireRow(id, query.company_id);
  }

  @Post(':id/approve')
  @RequireCompanyMembership({ type: 'body' })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveExtractionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const row = await this.requireRow(id, dto.company_id);
    const updated = await this.promotion.promote(row, {
      supplierId: dto.supplier_id,
      supplierName: dto.supplier_name,
      invoiceNumber: dto.invoice_number,
      invoiceDate: dto.invoice_date,
      accountId: dto.account_id,
      lines: dto.lines,
      actorId: user.id,
      confirm: true,
    });
    if (!updated.bill_id && updated.extracted_snapshot.review.hard_blocks.length > 0) {
      throw new BadRequestException({
        message: 'EXTRACTION_STILL_BLOCKED',
        hard_blocks: updated.extracted_snapshot.review.hard_blocks,
      });
    }
    return updated;
  }

  @Post(':id/reject')
  @RequireCompanyMembership({ type: 'body' })
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectExtractionDto) {
    const row = await this.requireRow(id, dto.company_id);
    return this.promotion.reject(row, dto.reason);
  }

  private async requireRow(id: string, companyId: string) {
    const row = await this.extractions.findById(id);
    if (!row || row.company_id !== companyId) {
      throw new NotFoundException('DOCUMENT_EXTRACTION_NOT_FOUND');
    }
    return row;
  }
}
