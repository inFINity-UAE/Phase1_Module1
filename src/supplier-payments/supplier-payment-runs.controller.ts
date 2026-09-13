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
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CreateSupplierPaymentRunDto } from './dto/create-supplier-payment-run.dto';
import { UpdateSupplierPaymentRunDto } from './dto/update-supplier-payment-run.dto';
import { SupplierPaymentsService } from './supplier-payments.service';

/** [feature-spec-1_1_E.md §5.5 / §4.3] Payment-run CRUD, approve, execute. */
@Controller('supplier-payment-runs')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class SupplierPaymentRunsController {
  constructor(private readonly supplierPaymentsService: SupplierPaymentsService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body' })
  create(@Body() dto: CreateSupplierPaymentRunDto, @CurrentUser() user: AuthenticatedUser) {
    return this.supplierPaymentsService.createRun(dto, user.id);
  }

  @Get()
  @RequireCompanyMembership({ type: 'query' })
  findAll(@Query('company_id') companyId: string) {
    return this.supplierPaymentsService.findAllRuns(companyId);
  }

  @Get(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'supplier_payment_run' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.supplierPaymentsService.findRun(id);
  }

  @Patch(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'supplier_payment_run' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierPaymentRunDto) {
    return this.supplierPaymentsService.updateRunHeader(id, dto);
  }

  @Post(':id/cancel')
  @RequireCompanyMembership({ type: 'param', resource: 'supplier_payment_run' })
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.supplierPaymentsService.cancelRun(id);
  }

  @Post(':id/approve')
  @RequireCompanyMembership({ type: 'param', resource: 'supplier_payment_run' })
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.supplierPaymentsService.approveRun(id, user.id, user.role);
  }

  @Post(':id/execute')
  @RequireCompanyMembership({ type: 'param', resource: 'supplier_payment_run' })
  execute(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.supplierPaymentsService.executeRun(id, user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCompanyMembership({ type: 'param', resource: 'supplier_payment_run' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.supplierPaymentsService.removeRun(id);
  }
}
