import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { DocumentBatchesService } from './document-batches.service';
import { CreateDocumentBatchDto, DocumentBatchQueryDto } from './dto/create-document-batch.dto';

/** [feature-spec-1_1_B.md §4] Enqueue a batch and read its progress. */
@Controller('document-batches')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class DocumentBatchesController {
  constructor(private readonly batches: DocumentBatchesService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body' })
  create(@Body() dto: CreateDocumentBatchDto) {
    return this.batches.create(dto);
  }

  @Get(':batchId')
  @RequireCompanyMembership({ type: 'query' })
  status(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Query() query: DocumentBatchQueryDto,
  ) {
    return this.batches.status(batchId, query.company_id);
  }
}
