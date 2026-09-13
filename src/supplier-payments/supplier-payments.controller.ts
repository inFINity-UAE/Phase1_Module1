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
import { CreateSupplierPaymentApplicationDto } from './dto/create-supplier-payment-application.dto';
import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto';
import { UpdateSupplierPaymentDto } from './dto/update-supplier-payment.dto';
import { SupplierPaymentsService } from './supplier-payments.service';

/** [feature-spec-1_1_E.md §5.5] Supplier payment CRUD + post + nested applications. */
@Controller('supplier-payments')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class SupplierPaymentsController {
  constructor(private readonly supplierPaymentsService: SupplierPaymentsService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body' })
  create(@Body() dto: CreateSupplierPaymentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.supplierPaymentsService.createPayment(dto, user.id);
  }

  @Get()
  @RequireCompanyMembership({ type: 'query' })
  findAll(@Query('company_id') companyId: string) {
    return this.supplierPaymentsService.findAllPayments(companyId);
  }

  @Get(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'supplier_payment' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.supplierPaymentsService.findPayment(id);
  }

  @Patch(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'supplier_payment' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierPaymentDto,
  ) {
    return this.supplierPaymentsService.updatePayment(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCompanyMembership({ type: 'param', resource: 'supplier_payment' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.supplierPaymentsService.removePayment(id);
  }

  @Post(':id/post')
  @RequireCompanyMembership({ type: 'param', resource: 'supplier_payment' })
  post(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.supplierPaymentsService.postPayment(id, user.id);
  }

  @Post(':id/applications')
  @RequireCompanyMembership({ type: 'param', resource: 'supplier_payment' })
  createApplication(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSupplierPaymentApplicationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supplierPaymentsService.createApplication(id, dto, user.id);
  }

  @Delete(':id/applications/:applicationId')
  @HttpCode(204)
  @RequireCompanyMembership({ type: 'param', resource: 'supplier_payment' })
  removeApplication(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ) {
    return this.supplierPaymentsService.deleteApplication(id, applicationId);
  }

  @Post(':id/applications/:applicationId/post')
  @RequireCompanyMembership({ type: 'param', resource: 'supplier_payment' })
  postApplication(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supplierPaymentsService.postAdvanceApplication(id, applicationId, user.id);
  }
}
