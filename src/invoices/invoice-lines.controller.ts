import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CreateInvoiceLineRequestDto } from './dto/create-invoice-line-request.dto';
import { UpdateInvoiceLineDto } from './dto/update-invoice-line.dto';
import { InvoicesService } from './invoices.service';

/** [feature-spec-1.1.C.md §1.3] Invoice line CRUD while parent is draft. */
@Controller('invoice-lines')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class InvoiceLinesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body_ref', resource: 'invoice', field: 'invoice_id' })
  create(@Body() dto: CreateInvoiceLineRequestDto) {
    return this.invoicesService.createLine(dto);
  }

  @Patch(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'invoice_line' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInvoiceLineDto) {
    return this.invoicesService.updateLine(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCompanyMembership({ type: 'param', resource: 'invoice_line' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicesService.deleteLine(id);
  }
}
