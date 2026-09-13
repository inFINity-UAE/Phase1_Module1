import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { ConfirmSupplierStatementMatchDto } from './dto/confirm-supplier-statement-match.dto';
import { CreateSupplierStatementLineDto } from './dto/create-supplier-statement-line.dto';
import { UpdateSupplierStatementLineDto } from './dto/update-supplier-statement-line.dto';
import { SupplierPaymentsService } from './supplier-payments.service';

/** [feature-spec-1_1_E.md §5.5 / E-11 / E-22] Statement lines + confirm-match. */
@Controller('supplier-statement-lines')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class SupplierStatementLinesController {
  constructor(private readonly supplierPaymentsService: SupplierPaymentsService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body' })
  create(@Body() dto: CreateSupplierStatementLineDto) {
    return this.supplierPaymentsService.createStatementLine(dto);
  }

  @Get()
  @RequireCompanyMembership({ type: 'query' })
  findAll(@Query('company_id') companyId: string) {
    return this.supplierPaymentsService.findAllStatementLines(companyId);
  }

  @Get(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'supplier_statement_line' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.supplierPaymentsService.findStatementLine(id);
  }

  @Patch(':id/confirm-match')
  @RequireCompanyMembership({ type: 'param', resource: 'supplier_statement_line' })
  confirmMatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmSupplierStatementMatchDto,
  ) {
    return this.supplierPaymentsService.confirmStatementMatch(id, dto);
  }

  @Patch(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'supplier_statement_line' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierStatementLineDto,
  ) {
    return this.supplierPaymentsService.updateStatementLine(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCompanyMembership({ type: 'param', resource: 'supplier_statement_line' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.supplierPaymentsService.removeStatementLine(id);
  }
}
