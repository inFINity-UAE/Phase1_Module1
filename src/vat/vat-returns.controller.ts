import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import {
  AccrueVatPenaltyDto,
  CalculateVatReturnDto,
  CreateVatCorrectionDto,
  RecordVatPaymentDto,
} from './dto/vat.dto';
import { VatService } from './vat.service';

/** [feature-spec-1_1_F.md §5] VAT 201 calculate / review / approve / file. */
@Controller('vat-returns')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class VatReturnsController {
  constructor(private readonly vatService: VatService) {}

  @Post('calculate')
  @RequireCompanyMembership({ type: 'body' })
  calculate(@Body() dto: CalculateVatReturnDto, @CurrentUser() user: AuthenticatedUser) {
    return this.vatService.calculate(dto, user.id);
  }

  @Get()
  @RequireCompanyMembership({ type: 'query' })
  findAll(@Query('company_id') companyId: string) {
    return this.vatService.findAll(companyId);
  }

  @Get(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'vat_return_period' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.vatService.findOne(id);
  }

  @Get(':id/groups/:group_key/transactions')
  @RequireCompanyMembership({ type: 'param', resource: 'vat_return_period' })
  groupTransactions(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('group_key') groupKey: string,
  ) {
    return this.vatService.groupTransactions(id, groupKey);
  }

  @Post(':id/submit-for-review')
  @RequireCompanyMembership({ type: 'param', resource: 'vat_return_period' })
  submitForReview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vatService.submitForReview(id, user.id, user.role);
  }

  @Post(':id/approve')
  @RequireCompanyMembership({ type: 'param', resource: 'vat_return_period' })
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.vatService.approve(id, user.id, user.role);
  }

  @Post(':id/file')
  @RequireCompanyMembership({ type: 'param', resource: 'vat_return_period' })
  file(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.vatService.file(id, user.id, user.role);
  }

  @Get(':id/export')
  @RequireCompanyMembership({ type: 'param', resource: 'vat_return_period' })
  export(@Param('id', ParseUUIDPipe) id: string) {
    return this.vatService.export(id);
  }

  @Post(':id/reconcile')
  @RequireCompanyMembership({ type: 'param', resource: 'vat_return_period' })
  reconcile(@Param('id', ParseUUIDPipe) id: string) {
    return this.vatService.reconcile(id);
  }

  @Post(':id/claim-refund')
  @RequireCompanyMembership({ type: 'param', resource: 'vat_return_period' })
  claimRefund(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.vatService.claimRefund(id, user.id, user.role);
  }

  @Post(':id/record-payment')
  @RequireCompanyMembership({ type: 'param', resource: 'vat_return_period' })
  recordPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordVatPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vatService.recordPayment(id, dto, user.id);
  }

  @Post(':id/accrue-penalty')
  @RequireCompanyMembership({ type: 'param', resource: 'vat_return_period' })
  accruePenalty(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AccrueVatPenaltyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vatService.accruePenalty(id, dto.amount, user.id, user.role);
  }

  @Post(':id/corrections')
  @RequireCompanyMembership({ type: 'param', resource: 'vat_return_period' })
  corrections(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateVatCorrectionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vatService.createCorrection(id, dto, user.id);
  }
}
