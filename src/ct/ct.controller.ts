import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CtService } from './ct.service';
import {
  CreateCtIncomeAdjustmentDto,
  CtCompanyQueryDto,
  CtCompanyYearQueryDto,
  CtFiscalYearBodyDto,
  RecordRelatedPartyTransactionDto,
} from './dto/ct.dto';

/** [feature-spec-1_1_G.md §5 / G-21] company_id on body/query, not /companies/:id/ct. */
@Controller('ct')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class CtController {
  constructor(private readonly ctService: CtService) {}

  @Get('taxable-profit')
  @RequireCompanyMembership({ type: 'query' })
  taxableProfit(@Query() query: CtCompanyYearQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ctService.taxableProfit(query.company_id, query.fiscal_year, user.role);
  }

  @Post('provisions/calculate')
  @RequireCompanyMembership({ type: 'body' })
  calculate(@Body() dto: CtFiscalYearBodyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ctService.calculate(dto, user.role);
  }

  @Post('provisions/post')
  @RequireCompanyMembership({ type: 'body' })
  postProvision(@Body() dto: CtFiscalYearBodyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ctService.postProvision(dto, user.id, user.role);
  }

  @Get('provisions')
  @RequireCompanyMembership({ type: 'query' })
  listProvisions(@Query() query: CtCompanyYearQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ctService.listProvisions(query.company_id, query.fiscal_year, user.role);
  }

  @Get('sbr-eligibility')
  @RequireCompanyMembership({ type: 'query' })
  sbrEligibility(@Query() query: CtCompanyYearQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ctService.sbrEligibility(query.company_id, query.fiscal_year, user.role);
  }

  @Post('income-adjustments')
  @RequireCompanyMembership({ type: 'body' })
  createIncomeAdjustment(
    @Body() dto: CreateCtIncomeAdjustmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ctService.createIncomeAdjustment(dto, user.id, user.role);
  }

  @Get('free-zone-summary')
  @RequireCompanyMembership({ type: 'query' })
  freeZoneSummary(@Query() query: CtCompanyYearQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ctService.freeZoneSummary(query.company_id, query.fiscal_year, user.role);
  }

  @Post('related-party-transactions')
  @RequireCompanyMembership({ type: 'body' })
  recordRelatedParty(
    @Body() dto: RecordRelatedPartyTransactionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ctService.recordRelatedParty(dto, user.role);
  }

  @Get('related-party-transactions')
  @RequireCompanyMembership({ type: 'query' })
  listRelatedParty(@Query() query: CtCompanyQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ctService.listRelatedParty(query.company_id, user.role);
  }

  @Get('return-summary')
  @RequireCompanyMembership({ type: 'query' })
  returnSummary(@Query() query: CtCompanyYearQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ctService.returnSummary(query.company_id, query.fiscal_year, user.role);
  }

  @Get('registration-status')
  @RequireCompanyMembership({ type: 'query' })
  registrationStatus(@Query() query: CtCompanyQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ctService.registrationStatus(query.company_id, user.role);
  }

  @Get('penalty-exposure')
  @RequireCompanyMembership({ type: 'query' })
  penaltyExposure(@Query() query: CtCompanyYearQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ctService.penaltyExposure(query.company_id, query.fiscal_year, user.role);
  }
}
