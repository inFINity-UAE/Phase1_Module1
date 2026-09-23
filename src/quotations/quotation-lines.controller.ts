import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CreateQuotationLineRequestDto } from './dto/create-quotation-line-request.dto';
import { UpdateQuotationLineDto } from './dto/update-quotation-line.dto';
import { QuotationsService } from './quotations.service';

/** [feature-spec-1_1_C.md §1.2] Quotation line CRUD while parent is draft. */
@Controller('quotation-lines')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class QuotationLinesController {
  constructor(private readonly quotationsService: QuotationsService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body_ref', resource: 'quotation', field: 'quotation_id' })
  create(@Body() dto: CreateQuotationLineRequestDto) {
    return this.quotationsService.createLine(dto);
  }

  @Patch(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'quotation_line' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateQuotationLineDto) {
    return this.quotationsService.updateLine(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCompanyMembership({ type: 'param', resource: 'quotation_line' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotationsService.deleteLine(id);
  }
}
