import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { BalanceSheetQueryDto } from './dto/balance-sheet-query.dto';
import { GeneralLedgerQueryDto } from './dto/general-ledger-query.dto';
import { ProfitAndLossQueryDto } from './dto/profit-and-loss-query.dto';
import { TrialBalanceQueryDto } from './dto/trial-balance-query.dto';
import { ReportsService } from './reports.service';

/**
 * [feature-spec-1.1.H1.md decisions #1/#2/#3/#5] Core Financial Reports.
 */
@Controller('reports')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('trial-balance')
  @RequireCompanyMembership({ type: 'query' })
  getTrialBalance(@Query() query: TrialBalanceQueryDto) {
    return this.reportsService.getTrialBalance(
      query.company_id,
      query.period_id,
      query.include_zero_balance ?? false,
    );
  }

  /**
   * [feature-spec-1.1.H1.md decision #2] as_of_date optional — Nest defaults
   * to server today when omitted.
   */
  @Get('balance-sheet')
  @RequireCompanyMembership({ type: 'query' })
  getBalanceSheet(@Query() query: BalanceSheetQueryDto) {
    return this.reportsService.getBalanceSheet(
      query.company_id,
      query.as_of_date,
    );
  }

  /**
   * [feature-spec-1.1.H1.md decision #3] Single-period P&L — all three
   * query params required; no prior-period comparison (deferred to H2).
   */
  @Get('profit-and-loss')
  @RequireCompanyMembership({ type: 'query' })
  getProfitAndLoss(@Query() query: ProfitAndLossQueryDto) {
    return this.reportsService.getProfitAndLoss(
      query.company_id,
      query.period_start,
      query.period_end,
    );
  }

  /**
   * [feature-spec-1.1.H1.md decision #5] General Ledger — company_id required;
   * account_id / date_from / date_to optional. Pagination deferred.
   */
  @Get('general-ledger')
  @RequireCompanyMembership({ type: 'query' })
  getGeneralLedger(@Query() query: GeneralLedgerQueryDto) {
    return this.reportsService.getGeneralLedger(
      query.company_id,
      query.account_id,
      query.date_from,
      query.date_to,
    );
  }
}
