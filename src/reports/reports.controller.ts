import { Controller, Get, Post, Query, Body, Param, ParseUUIDPipe, UseGuards, UseInterceptors } from '@nestjs/common';
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { AgedReceivablesQueryDto } from './dto/aged-receivables-query.dto';
import { AuditPackQueryDto } from './dto/audit-pack-query.dto';
import { BalanceSheetQueryDto } from './dto/balance-sheet-query.dto';
import { CreditLimitCheckQueryDto } from './dto/credit-limit-check-query.dto';
import { CustomerLedgerQueryDto } from './dto/customer-ledger-query.dto';
import { CustomerPaymentHistoryQueryDto } from './dto/customer-payment-history-query.dto';
import { ExpenseAnalysisQueryDto } from './dto/expense-analysis-query.dto';
import { ExecutiveSummaryQueryDto } from './dto/executive-summary-query.dto';
import { GeneralLedgerQueryDto } from './dto/general-ledger-query.dto';
import { ProfitAndLossComparisonQueryDto } from './dto/profit-and-loss-comparison-query.dto';
import { ProfitAndLossQueryDto } from './dto/profit-and-loss-query.dto';
import { SalesByCustomerQueryDto } from './dto/sales-by-customer-query.dto';
import { TrialBalanceQueryDto } from './dto/trial-balance-query.dto';
import { TrialBalanceRangeQueryDto } from './dto/trial-balance-range-query.dto';
import { AgedPayablesQueryDto } from './dto/aged-payables-query.dto';
import { BillsDueQueryDto } from './dto/bills-due-query.dto';
import { ReconcileSupplierStatementDto } from './dto/reconcile-supplier-statement.dto';
import { SupplierLedgerQueryDto } from './dto/supplier-ledger-query.dto';
import { InvoiceRegisterQueryDto, VatRegistrationThresholdQueryDto } from './dto/vat-reports-query.dto';
import { ReportsCsvInterceptor } from './reports-csv.interceptor';
import { ReportsService } from './reports.service';

/**
 * [feature-spec-1.1.H.md] + D/E/F report routes.
 * Thin read routes over Postgres report RPCs — no Nest-side aggregation
 * except H2-1 totals (summarizeProfitAndLoss twice) and H2-6 composition.
 */
@Controller('reports')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
@UseInterceptors(ReportsCsvInterceptor)
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

  @Get('trial-balance-range')
  @RequireCompanyMembership({ type: 'query' })
  getTrialBalanceForRange(@Query() query: TrialBalanceRangeQueryDto) {
    return this.reportsService.getTrialBalanceForRange(
      query.company_id,
      query.range_start,
      query.range_end,
      query.include_zero_balance ?? false,
    );
  }

  @Get('balance-sheet')
  @RequireCompanyMembership({ type: 'query' })
  getBalanceSheet(@Query() query: BalanceSheetQueryDto) {
    return this.reportsService.getBalanceSheet(
      query.company_id,
      query.as_of_date,
    );
  }

  @Get('profit-and-loss')
  @RequireCompanyMembership({ type: 'query' })
  getProfitAndLoss(@Query() query: ProfitAndLossQueryDto) {
    return this.reportsService.getProfitAndLoss(
      query.company_id,
      query.period_start,
      query.period_end,
    );
  }

  @Get('profit-and-loss-comparison')
  @RequireCompanyMembership({ type: 'query' })
  getProfitAndLossComparison(@Query() query: ProfitAndLossComparisonQueryDto) {
    return this.reportsService.getProfitAndLossComparison(
      query.company_id,
      query.period_a_start,
      query.period_a_end,
      query.period_b_start,
      query.period_b_end,
    );
  }

  @Get('general-ledger')
  @RequireCompanyMembership({ type: 'query' })
  getGeneralLedger(@Query() query: GeneralLedgerQueryDto) {
    return this.reportsService.getGeneralLedger(
      query.company_id,
      query.account_id,
      query.date_from,
      query.date_to,
      query.limit,
      query.offset,
    );
  }

  @Get('expense-analysis')
  @RequireCompanyMembership({ type: 'query' })
  getExpenseAnalysis(@Query() query: ExpenseAnalysisQueryDto) {
    return this.reportsService.getExpenseAnalysis(query.company_id, query.fiscal_year);
  }

  @Get('sales-by-customer')
  @RequireCompanyMembership({ type: 'query' })
  getSalesByCustomer(@Query() query: SalesByCustomerQueryDto) {
    return this.reportsService.getSalesByCustomer(
      query.company_id,
      query.period_start,
      query.period_end,
    );
  }

  @Get('executive-summary')
  @RequireCompanyMembership({ type: 'query' })
  getExecutiveSummary(@Query() query: ExecutiveSummaryQueryDto) {
    return this.reportsService.getExecutiveSummary(
      query.company_id,
      query.period_start,
      query.period_end,
    );
  }

  @Get('audit-pack')
  @RequireCompanyMembership({ type: 'query' })
  getAuditPack(@Query() query: AuditPackQueryDto) {
    return this.reportsService.getAuditPack(query.company_id, query.period_id);
  }

  /** [feature-spec-1_1_D.md §5.1] */
  @Get('customer-ledger')
  @RequireCompanyMembership({ type: 'query' })
  getCustomerLedger(@Query() query: CustomerLedgerQueryDto) {
    return this.reportsService.getCustomerLedger(
      query.company_id,
      query.customer_id,
      query.date_from,
      query.date_to,
    );
  }

  /** [feature-spec-1_1_D.md §5.4] Data only — PDF deferred. */
  @Get('customer-statement')
  @RequireCompanyMembership({ type: 'query' })
  getCustomerStatement(@Query() query: CustomerLedgerQueryDto) {
    return this.reportsService.getCustomerStatement(
      query.company_id,
      query.customer_id,
      query.date_from,
      query.date_to,
    );
  }

  /** [feature-spec-1_1_D.md §5.2 / D-5] */
  @Get('aged-receivables')
  @RequireCompanyMembership({ type: 'query' })
  getAgedReceivables(@Query() query: AgedReceivablesQueryDto) {
    return this.reportsService.getAgedReceivables(
      query.company_id,
      query.as_of_date,
    );
  }

  /** [feature-spec-1_1_D.md §5.3 / D-4] Alert-only credit-limit check. */
  @Get('credit-limit-check')
  @RequireCompanyMembership({ type: 'query' })
  checkCustomerCreditLimit(@Query() query: CreditLimitCheckQueryDto) {
    return this.reportsService.checkCustomerCreditLimit(
      query.company_id,
      query.customer_id,
    );
  }

  /** [feature-spec-1_1_D.md §5.5] */
  @Get('customer-payment-history')
  @RequireCompanyMembership({ type: 'query' })
  getCustomerPaymentHistory(@Query() query: CustomerPaymentHistoryQueryDto) {
    return this.reportsService.getCustomerPaymentHistory(
      query.company_id,
      query.customer_id,
    );
  }

  /** [feature-spec-1_1_E.md §5.1] */
  @Get('supplier-ledger')
  @RequireCompanyMembership({ type: 'query' })
  getSupplierLedger(@Query() query: SupplierLedgerQueryDto) {
    return this.reportsService.getSupplierLedger(
      query.company_id,
      query.supplier_id,
      query.date_from,
      query.date_to,
    );
  }

  /** [feature-spec-1_1_E.md §5.2] */
  @Get('aged-payables')
  @RequireCompanyMembership({ type: 'query' })
  getAgedPayables(@Query() query: AgedPayablesQueryDto) {
    return this.reportsService.getAgedPayables(query.company_id, query.as_of_date);
  }

  /** [feature-spec-1_1_E.md §5.2 / §5.4] */
  @Get('bills-due')
  @RequireCompanyMembership({ type: 'query' })
  getBillsDue(@Query() query: BillsDueQueryDto) {
    return this.reportsService.getBillsDue(query.company_id, query.as_of_date);
  }

  /** [feature-spec-1_1_E.md §5.3 / E-22] */
  @Post('reconcile-supplier-statement')
  @RequireCompanyMembership({ type: 'body' })
  reconcileSupplierStatement(@Body() dto: ReconcileSupplierStatementDto) {
    return this.reportsService.reconcileSupplierStatement(
      dto.company_id,
      dto.supplier_id,
      dto.statement_date,
    );
  }

  /** [feature-spec-1_1_F.md F-16] */
  @Get('invoice-register')
  @RequireCompanyMembership({ type: 'query' })
  getInvoiceRegister(@Query() query: InvoiceRegisterQueryDto) {
    return this.reportsService.getInvoiceRegister(query.company_id, query.year);
  }

  /** [feature-spec-1_1_F.md F-32] */
  @Get('vat-registration-threshold')
  @RequireCompanyMembership({ type: 'query' })
  getVatRegistrationThreshold(@Query() query: VatRegistrationThresholdQueryDto) {
    return this.reportsService.getVatRegistrationThreshold(query.company_id, query.as_of);
  }

  /** [feature-spec-1_1_F.md F-15] */
  @Get('vat-audit-pack/:id')
  @RequireCompanyMembership({ type: 'param', resource: 'vat_return_period' })
  getVatAuditPack(@Param('id', ParseUUIDPipe) id: string) {
    return this.reportsService.assembleVatAuditPack(id);
  }
}
