import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { AccountsController } from '../accounts/accounts.controller';
import { AccountsService } from '../accounts/accounts.service';
import { CustomersController } from '../customers/customers.controller';
import { CustomersService } from '../customers/customers.service';
import { QuotationsController } from '../quotations/quotations.controller';
import { QuotationLinesController } from '../quotations/quotation-lines.controller';
import { QuotationsService } from '../quotations/quotations.service';
import { InvoicesController } from '../invoices/invoices.controller';
import { InvoiceLinesController } from '../invoices/invoice-lines.controller';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentsController } from '../payments/payments.controller';
import { PaymentApplicationsController } from '../payments/payment-applications.controller';
import { PaymentsService } from '../payments/payments.service';
import { PublicHolidaysController } from '../public-holidays/public-holidays.controller';
import { PublicHolidaysService } from '../public-holidays/public-holidays.service';
import { CreditNotesController } from '../credit-notes/credit-notes.controller';
import { CreditNoteLinesController } from '../credit-notes/credit-note-lines.controller';
import { CreditNotesService } from '../credit-notes/credit-notes.service';
import { AccountingPeriodsController } from '../accounting-periods/accounting-periods.controller';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { AuditLogController } from '../audit-log/audit-log.controller';
import { AuditLogService } from '../audit-log/audit-log.service';
import { SupabaseService } from '../database/supabase.service';
import { JournalEntriesController } from '../journal-entries/journal-entries.controller';
import { JournalLinesController } from '../journal-entries/journal-lines.controller';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import {
  RecurringJournalTemplateLinesController,
  RecurringJournalTemplatesController,
} from '../recurring-journal-templates/recurring-journal-templates.controller';
import { RecurringJournalTemplatesService } from '../recurring-journal-templates/recurring-journal-templates.service';
import { CompanyMembersService } from '../company-members/company-members.service';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CompanyRole } from './enums/company-role.enum';
import { ReportsController } from '../reports/reports.controller';
import { ReportsService } from '../reports/reports.service';
import { SuppliersController } from '../suppliers/suppliers.controller';
import { SuppliersService } from '../suppliers/suppliers.service';
import { PurchaseOrdersController } from '../purchase-orders/purchase-orders.controller';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';
import { GoodsReceiptsController } from '../goods-receipts/goods-receipts.controller';
import { GoodsReceiptsService } from '../goods-receipts/goods-receipts.service';
import { BillsController } from '../bills/bills.controller';
import { BillsService } from '../bills/bills.service';
import { SupplierPaymentsController } from '../supplier-payments/supplier-payments.controller';
import { SupplierPaymentRunsController } from '../supplier-payments/supplier-payment-runs.controller';
import { SupplierStatementLinesController } from '../supplier-payments/supplier-statement-lines.controller';
import { SupplierPaymentsService } from '../supplier-payments/supplier-payments.service';
import { VatReturnsController } from '../vat/vat-returns.controller';
import { VatApportionmentController } from '../vat/vat-apportionment.controller';
import {
  CapitalGoodsItemsController,
  CapitalGoodsProjectsController,
} from '../vat/capital-goods.controller';
import {
  BadDebtReliefClaimsController,
  VatVoluntaryDisclosuresController,
} from '../vat/vat-claims.controller';
import { VatService } from '../vat/vat.service';
import { CtController } from '../ct/ct.controller';
import { CtService } from '../ct/ct.service';

/**
 * [feature-spec.md decisions #24/#27/#41; feature-spec-1.1.H1.md #1]
 * Controllers reject unauthenticated requests (401) and succeed for a
 * verified Bearer session with membership. Regression list covers all
 * 218 guarded HTTP routes across controllers.
 *
 * Blind spot (C1-3): this spec registers controllers in isolation and mocks
 * CompanyMembershipGuard + CompanyMembersService — it does NOT import real
 * feature modules, so a missing AuthModule import on InvoicesModule (etc.)
 * will not fail here. Static loop-closer:
 *   node scripts/verify-auth-module-imports.mjs
 * Real-module integration specs (where they exist) catch it at compile time.
 */
describe('Controller auth coverage (decision #24)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let getUser: jest.Mock;
  let resolveRole: jest.Mock;
  let resolveCompanyIdForResource: jest.Mock;

  const sessionUserId = '00000000-0000-0000-0000-0000000000a2';
  const companyId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const accountId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const periodId = '22222222-2222-2222-2222-222222222222';
  const entryId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const templateId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const templateLineId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  const journalLineId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  const customerId = '11111111-1111-1111-1111-111111111111';
  const quotationId = '12121212-1212-1212-1212-121212121212';
  const quotationLineId = '13131313-1313-1313-1313-131313131313';
  const invoiceId = '14141414-1414-1414-1414-141414141414';
  const invoiceLineId = '15151515-1515-1515-1515-151515151515';
  const creditNoteId = '16161616-1616-1616-1616-161616161616';
  const creditNoteLineId = '17171717-1717-1717-1717-171717171717';
  const paymentId = '18181818-1818-1818-1818-181818181818';
  const paymentApplicationId = '19191919-1919-1919-1919-191919191919';
  const publicHolidayId = '1a1a1a1a-1a1a-1a1a-1a1a-1a1a1a1a1a1a';
  const supplierId = '1b1b1b1b-1b1b-1b1b-1b1b-1b1b1b1b1b1b';
  const purchaseOrderId = '1c1c1c1c-1c1c-1c1c-1c1c-1c1c1c1c1c1c';
  const purchaseOrderLineId = '1d1d1d1d-1d1d-1d1d-1d1d-1d1d1d1d1d1d';
  const goodsReceiptId = '1e1e1e1e-1e1e-1e1e-1e1e-1e1e1e1e1e1e';
  const goodsReceiptLineId = '1f1f1f1f-1f1f-1f1f-1f1f-1f1f1f1f1f1f';
  const billId = '20202020-2020-2020-2020-202020202020';
  const billLineId = '21212121-2121-2121-2121-212121212121';
  const supplierPaymentId = '22222222-2222-2222-2222-222222222221';
  const supplierPaymentAppId = '23232323-2323-2323-2323-232323232323';
  const paymentRunId = '24242424-2424-2424-2424-242424242424';
  const statementLineId = '25252525-2525-2525-2525-252525252525';
  const vatReturnId = '26262626-2626-2626-2626-262626262626';
  const capitalGoodsProjectId = '27272727-2727-2727-2727-272727272721';
  const capitalGoodsItemId = '28282828-2828-2828-2828-282828282828';
  const vatClaimId = '29292929-2929-2929-2929-292929292929';
  const vatVdId = '2a2a2a2a-2a2a-2a2a-2a2a-2a2a2a2a2a2a';

  const journalEntryDetails = {
    entry: { id: entryId, company_id: companyId },
    lines: [],
    attachments: [],
  };

  /** Canonical 42-route list — keep in sync with company-membership.guard.integration.spec.ts */
  const ALL_GUARDED_ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
    {
      method: 'GET',
      path: `/reports/trial-balance?company_id=${companyId}&period_id=${periodId}`,
    },
    {
      method: 'GET',
      path: `/reports/balance-sheet?company_id=${companyId}&as_of_date=2026-01-31`,
    },
    {
      method: 'GET',
      path: `/reports/profit-and-loss?company_id=${companyId}&period_start=2026-01-01&period_end=2026-01-31`,
    },
    {
      method: 'GET',
      path: `/reports/general-ledger?company_id=${companyId}`,
    },
    {
      method: 'GET',
      path: `/reports/trial-balance-range?company_id=${companyId}&range_start=2026-01-01&range_end=2026-01-31`,
    },
    {
      method: 'GET',
      path: `/reports/profit-and-loss-comparison?company_id=${companyId}&period_a_start=2026-01-01&period_a_end=2026-01-31`,
    },
    {
      method: 'GET',
      path: `/reports/expense-analysis?company_id=${companyId}&fiscal_year=2026`,
    },
    {
      method: 'GET',
      path: `/reports/sales-by-customer?company_id=${companyId}&period_start=2026-01-01&period_end=2026-01-31`,
    },
    {
      method: 'GET',
      path: `/reports/executive-summary?company_id=${companyId}&period_start=2026-01-01&period_end=2026-01-31`,
    },
    {
      method: 'GET',
      path: `/reports/audit-pack?company_id=${companyId}&period_id=${periodId}`,
    },
    {
      method: 'GET',
      path: `/reports/customer-ledger?company_id=${companyId}&customer_id=${customerId}`,
    },
    {
      method: 'GET',
      path: `/reports/customer-statement?company_id=${companyId}&customer_id=${customerId}`,
    },
    {
      method: 'GET',
      path: `/reports/aged-receivables?company_id=${companyId}&as_of_date=2026-01-31`,
    },
    {
      method: 'GET',
      path: `/reports/credit-limit-check?company_id=${companyId}&customer_id=${customerId}`,
    },
    {
      method: 'GET',
      path: `/reports/customer-payment-history?company_id=${companyId}&customer_id=${customerId}`,
    },
    {
      method: 'GET',
      path: `/reports/supplier-ledger?company_id=${companyId}&supplier_id=${supplierId}`,
    },
    {
      method: 'GET',
      path: `/reports/aged-payables?company_id=${companyId}&as_of_date=2026-01-31`,
    },
    {
      method: 'GET',
      path: `/reports/bills-due?company_id=${companyId}&as_of_date=2026-01-31`,
    },
    {
      method: 'POST',
      path: '/reports/reconcile-supplier-statement',
      body: {
        company_id: companyId,
        supplier_id: supplierId,
        statement_date: '2026-01-31',
      },
    },
    { method: 'GET', path: `/reports/invoice-register?company_id=${companyId}&year=2026` },
    {
      method: 'GET',
      path: `/reports/vat-registration-threshold?company_id=${companyId}&as_of=2026-12-31`,
    },
    { method: 'GET', path: `/reports/vat-audit-pack/${vatReturnId}` },
    {
      method: 'POST',
      path: '/vat-returns/calculate',
      body: { company_id: companyId, period_start: '2026-01-01' },
    },
    { method: 'GET', path: `/vat-returns?company_id=${companyId}` },
    { method: 'GET', path: `/vat-returns/${vatReturnId}` },
    { method: 'GET', path: `/vat-returns/${vatReturnId}/groups/out_standard_rated/transactions` },
    { method: 'POST', path: `/vat-returns/${vatReturnId}/submit-for-review` },
    { method: 'POST', path: `/vat-returns/${vatReturnId}/approve` },
    { method: 'POST', path: `/vat-returns/${vatReturnId}/file` },
    { method: 'GET', path: `/vat-returns/${vatReturnId}/export` },
    { method: 'POST', path: `/vat-returns/${vatReturnId}/reconcile` },
    { method: 'POST', path: `/vat-returns/${vatReturnId}/claim-refund` },
    {
      method: 'POST',
      path: `/vat-returns/${vatReturnId}/record-payment`,
      body: { amount: 50, payment_date: '2026-04-28', method: 'bank_transfer' },
    },
    { method: 'POST', path: `/vat-returns/${vatReturnId}/accrue-penalty`, body: { amount: 1000 } },
    {
      method: 'POST',
      path: `/vat-returns/${vatReturnId}/corrections`,
      body: { delta_net_vat: 100, discovered_at: '2026-05-01' },
    },
    { method: 'POST', path: `/vat-apportionment/${vatReturnId}/calculate` },
    {
      method: 'POST',
      path: '/capital-goods-projects',
      body: { company_id: companyId, description: 'Tower', asset_category: 'building_real_estate' },
    },
    { method: 'GET', path: `/capital-goods-projects?company_id=${companyId}` },
    { method: 'GET', path: `/capital-goods-projects/${capitalGoodsProjectId}` },
    { method: 'PATCH', path: `/capital-goods-projects/${capitalGoodsProjectId}`, body: { description: 'Renamed' } },
    { method: 'DELETE', path: `/capital-goods-projects/${capitalGoodsProjectId}` },
    {
      method: 'POST',
      path: '/capital-goods-items',
      body: {
        company_id: companyId,
        description: 'Asset',
        acquisition_date: '2026-01-01',
        capital_value: 5000000,
        initial_vat: 250000,
        initial_recovery_pct: 100,
      },
    },
    { method: 'GET', path: `/capital-goods-items?company_id=${companyId}` },
    { method: 'GET', path: `/capital-goods-items/${capitalGoodsItemId}` },
    { method: 'PATCH', path: `/capital-goods-items/${capitalGoodsItemId}`, body: { description: 'Renamed' } },
    { method: 'DELETE', path: `/capital-goods-items/${capitalGoodsItemId}` },
    {
      method: 'POST',
      path: `/capital-goods-items/${capitalGoodsItemId}/adjust`,
      body: { fiscal_year: 2026, actual_use_pct: 80 },
    },
    {
      method: 'POST',
      path: '/bad-debt-relief-claims',
      body: { company_id: companyId, write_off_id: '27272727-2727-2727-2727-272727272727' },
    },
    { method: 'GET', path: `/bad-debt-relief-claims?company_id=${companyId}` },
    { method: 'POST', path: `/bad-debt-relief-claims/${vatClaimId}/claim` },
    { method: 'GET', path: `/vat-voluntary-disclosures?company_id=${companyId}` },
    { method: 'GET', path: `/vat-voluntary-disclosures/${vatVdId}` },
    { method: 'GET', path: `/ct/taxable-profit?company_id=${companyId}&fiscal_year=2026` },
    {
      method: 'POST',
      path: '/ct/provisions/calculate',
      body: { company_id: companyId, fiscal_year: 2026 },
    },
    {
      method: 'POST',
      path: '/ct/provisions/post',
      body: { company_id: companyId, fiscal_year: 2026 },
    },
    { method: 'GET', path: `/ct/provisions?company_id=${companyId}&fiscal_year=2026` },
    { method: 'GET', path: `/ct/sbr-eligibility?company_id=${companyId}&fiscal_year=2026` },
    {
      method: 'POST',
      path: '/ct/income-adjustments',
      body: {
        company_id: companyId,
        fiscal_year: 2026,
        adjustment_type: 'qualifying_dividend',
        amount: 100,
        journal_entry_id: entryId,
      },
    },
    { method: 'GET', path: `/ct/free-zone-summary?company_id=${companyId}&fiscal_year=2026` },
    {
      method: 'POST',
      path: '/ct/related-party-transactions',
      body: {
        company_id: companyId,
        counterparty_name: 'Related Co',
        relationship: 'shareholder',
        transaction_type: 'loan',
        amount: 1000,
        transaction_date: '2026-03-01',
      },
    },
    { method: 'GET', path: `/ct/related-party-transactions?company_id=${companyId}` },
    { method: 'GET', path: `/ct/return-summary?company_id=${companyId}&fiscal_year=2026` },
    { method: 'GET', path: `/ct/registration-status?company_id=${companyId}` },
    { method: 'GET', path: `/ct/penalty-exposure?company_id=${companyId}&fiscal_year=2026` },
    { method: 'POST', path: `/vat-voluntary-disclosures/${vatVdId}/approve` },
    { method: 'GET', path: `/accounts?company_id=${companyId}` },
    { method: 'GET', path: `/accounts/${accountId}` },
    {
      method: 'POST',
      path: '/accounts',
      body: {
        company_id: companyId,
        account_number: '1999',
        account_name: 'X',
        category: 'asset',
        normal_balance: 'debit',
      },
    },
    { method: 'PATCH', path: `/accounts/${accountId}/deactivate` },
    { method: 'PATCH', path: `/accounts/${accountId}`, body: { account_name: 'Renamed' } },
    { method: 'DELETE', path: `/accounts/${accountId}` },
    { method: 'GET', path: `/accounts/${accountId}/trial-balance` },
    {
      method: 'POST',
      path: '/customers',
      body: {
        company_id: companyId,
        customer_name: 'Auth coverage customer',
      },
    },
    { method: 'GET', path: `/customers?company_id=${companyId}` },
    { method: 'GET', path: `/customers/${customerId}` },
    { method: 'PATCH', path: `/customers/${customerId}`, body: { customer_name: 'Renamed' } },
    { method: 'PATCH', path: `/customers/${customerId}/deactivate` },
    {
      method: 'POST',
      path: '/quotations',
      body: {
        company_id: companyId,
        customer_id: customerId,
        quotation_date: '2026-03-01',
      },
    },
    { method: 'GET', path: `/quotations?company_id=${companyId}` },
    { method: 'GET', path: `/quotations/${quotationId}` },
    { method: 'PATCH', path: `/quotations/${quotationId}`, body: { notes: 'x' } },
    { method: 'DELETE', path: `/quotations/${quotationId}` },
    { method: 'POST', path: `/quotations/${quotationId}/send` },
    { method: 'POST', path: `/quotations/${quotationId}/mark-viewed` },
    { method: 'POST', path: `/quotations/${quotationId}/accept` },
    { method: 'POST', path: `/quotations/${quotationId}/decline` },
    { method: 'POST', path: `/quotations/${quotationId}/convert` },
    {
      method: 'POST',
      path: '/quotation-lines',
      body: {
        quotation_id: quotationId,
        line_number: 1,
        description: 'Line',
        quantity: 1,
        unit_price: 10,
        vat_rate: 5,
      },
    },
    { method: 'PATCH', path: `/quotation-lines/${quotationLineId}`, body: { quantity: 2 } },
    { method: 'DELETE', path: `/quotation-lines/${quotationLineId}` },
    {
      method: 'POST',
      path: '/invoices',
      body: {
        company_id: companyId,
        customer_id: customerId,
        invoice_date: '2026-06-01',
      },
    },
    { method: 'GET', path: `/invoices?company_id=${companyId}` },
    { method: 'GET', path: `/invoices/${invoiceId}` },
    { method: 'PATCH', path: `/invoices/${invoiceId}`, body: { payment_terms: 'net_30' } },
    { method: 'DELETE', path: `/invoices/${invoiceId}` },
    { method: 'POST', path: `/invoices/${invoiceId}/issue`, body: {} },
    { method: 'POST', path: `/invoices/${invoiceId}/void`, body: { void_reason: 'Auth probe' } },
    { method: 'POST', path: `/invoices/${invoiceId}/send` },
    { method: 'POST', path: `/invoices/${invoiceId}/mark-viewed` },
    { method: 'POST', path: `/invoices/${invoiceId}/write-off`, body: { reason: 'Auth probe' } },
    {
      method: 'PATCH',
      path: `/invoices/${invoiceId}/debtor-notified`,
      body: { debtor_notified_at: '2026-06-01' },
    },
    {
      method: 'POST',
      path: '/invoice-lines',
      body: {
        invoice_id: invoiceId,
        line_number: 1,
        description: 'Line',
        quantity: 1,
        unit_price: 10,
        vat_rate: 5,
      },
    },
    { method: 'PATCH', path: `/invoice-lines/${invoiceLineId}`, body: { quantity: 2 } },
    { method: 'DELETE', path: `/invoice-lines/${invoiceLineId}` },
    {
      method: 'POST',
      path: '/payments',
      body: {
        company_id: companyId,
        customer_id: customerId,
        payment_date: '2026-06-15',
        amount: 100,
        payment_method: 'bank_transfer',
      },
    },
    { method: 'GET', path: `/payments?company_id=${companyId}` },
    { method: 'GET', path: `/payments/${paymentId}` },
    {
      method: 'PATCH',
      path: `/payments/${paymentId}`,
      body: { reference_number: 'REF' },
    },
    { method: 'DELETE', path: `/payments/${paymentId}` },
    { method: 'POST', path: `/payments/${paymentId}/post` },
    {
      method: 'POST',
      path: '/payment-applications',
      body: {
        payment_id: paymentId,
        invoice_id: invoiceId,
        applied_amount: 50,
      },
    },
    { method: 'DELETE', path: `/payment-applications/${paymentApplicationId}` },
    { method: 'POST', path: `/payment-applications/${paymentApplicationId}/post` },
    {
      method: 'POST',
      path: '/suppliers',
      body: { company_id: companyId, supplier_name: 'Auth coverage supplier' },
    },
    { method: 'GET', path: `/suppliers?company_id=${companyId}` },
    { method: 'GET', path: `/suppliers/${supplierId}` },
    { method: 'PATCH', path: `/suppliers/${supplierId}`, body: { supplier_name: 'Renamed' } },
    { method: 'PATCH', path: `/suppliers/${supplierId}/deactivate` },
    {
      method: 'POST',
      path: '/purchase-orders',
      body: { company_id: companyId, supplier_id: supplierId, po_date: '2026-06-01' },
    },
    { method: 'GET', path: `/purchase-orders?company_id=${companyId}` },
    { method: 'GET', path: `/purchase-orders/${purchaseOrderId}` },
    { method: 'PATCH', path: `/purchase-orders/${purchaseOrderId}`, body: { po_date: '2026-06-02' } },
    { method: 'DELETE', path: `/purchase-orders/${purchaseOrderId}` },
    {
      method: 'POST',
      path: `/purchase-orders/${purchaseOrderId}/lines`,
      body: {
        line_number: 1,
        description: 'Item',
        quantity: 1,
        unit_price: 10,
        account_id: accountId,
      },
    },
    {
      method: 'PATCH',
      path: `/purchase-orders/${purchaseOrderId}/lines/${purchaseOrderLineId}`,
      body: { quantity: 2 },
    },
    { method: 'DELETE', path: `/purchase-orders/${purchaseOrderId}/lines/${purchaseOrderLineId}` },
    {
      method: 'POST',
      path: '/goods-receipts',
      body: {
        company_id: companyId,
        supplier_id: supplierId,
        purchase_order_id: purchaseOrderId,
        receipt_date: '2026-06-03',
      },
    },
    { method: 'GET', path: `/goods-receipts?company_id=${companyId}` },
    { method: 'GET', path: `/goods-receipts/${goodsReceiptId}` },
    { method: 'PATCH', path: `/goods-receipts/${goodsReceiptId}`, body: { receipt_date: '2026-06-04' } },
    { method: 'DELETE', path: `/goods-receipts/${goodsReceiptId}` },
    {
      method: 'POST',
      path: `/goods-receipts/${goodsReceiptId}/lines`,
      body: { purchase_order_line_id: purchaseOrderLineId, quantity_received: 1 },
    },
    {
      method: 'PATCH',
      path: `/goods-receipts/${goodsReceiptId}/lines/${goodsReceiptLineId}`,
      body: { quantity_received: 2 },
    },
    { method: 'DELETE', path: `/goods-receipts/${goodsReceiptId}/lines/${goodsReceiptLineId}` },
    {
      method: 'POST',
      path: '/bills',
      body: { company_id: companyId, supplier_id: supplierId, bill_date: '2026-06-05' },
    },
    { method: 'GET', path: `/bills?company_id=${companyId}` },
    { method: 'GET', path: `/bills/${billId}` },
    { method: 'PATCH', path: `/bills/${billId}`, body: { payment_terms: 'net_30' } },
    { method: 'DELETE', path: `/bills/${billId}` },
    { method: 'POST', path: `/bills/${billId}/match` },
    { method: 'POST', path: `/bills/${billId}/issue` },
    { method: 'POST', path: `/bills/${billId}/approve` },
    { method: 'POST', path: `/bills/${billId}/override-match-block`, body: { reason: 'Owner override' } },
    { method: 'POST', path: `/bills/${billId}/void`, body: { void_reason: 'Auth probe' } },
    { method: 'PATCH', path: `/bills/${billId}/schedule`, body: { scheduled_payment_date: '2026-07-01' } },
    { method: 'PATCH', path: `/bills/${billId}/dispute`, body: { disputed: true } },
    {
      method: 'POST',
      path: `/bills/${billId}/lines`,
      body: {
        line_number: 1,
        description: 'Expense',
        quantity: 1,
        unit_price: 10,
        vat_rate: 5,
        account_id: accountId,
      },
    },
    { method: 'PATCH', path: `/bills/${billId}/lines/${billLineId}`, body: { quantity: 2 } },
    { method: 'DELETE', path: `/bills/${billId}/lines/${billLineId}` },
    {
      method: 'POST',
      path: '/supplier-payments',
      body: {
        company_id: companyId,
        supplier_id: supplierId,
        payment_date: '2026-06-15',
        amount: 100,
        payment_method: 'bank_transfer',
      },
    },
    { method: 'GET', path: `/supplier-payments?company_id=${companyId}` },
    { method: 'GET', path: `/supplier-payments/${supplierPaymentId}` },
    { method: 'PATCH', path: `/supplier-payments/${supplierPaymentId}`, body: { reference_number: 'REF' } },
    { method: 'DELETE', path: `/supplier-payments/${supplierPaymentId}` },
    { method: 'POST', path: `/supplier-payments/${supplierPaymentId}/post` },
    {
      method: 'POST',
      path: `/supplier-payments/${supplierPaymentId}/applications`,
      body: { bill_id: billId, applied_amount: 50 },
    },
    { method: 'DELETE', path: `/supplier-payments/${supplierPaymentId}/applications/${supplierPaymentAppId}` },
    { method: 'POST', path: `/supplier-payments/${supplierPaymentId}/applications/${supplierPaymentAppId}/post` },
    {
      method: 'POST',
      path: '/supplier-payment-runs',
      body: {
        company_id: companyId,
        run_date: '2026-06-16',
        payment_method: 'bank_transfer',
        items: [{ bill_id: billId, supplier_id: supplierId, amount_to_pay: 50 }],
      },
    },
    { method: 'GET', path: `/supplier-payment-runs?company_id=${companyId}` },
    { method: 'GET', path: `/supplier-payment-runs/${paymentRunId}` },
    { method: 'PATCH', path: `/supplier-payment-runs/${paymentRunId}`, body: { run_date: '2026-06-17' } },
    { method: 'POST', path: `/supplier-payment-runs/${paymentRunId}/cancel` },
    { method: 'POST', path: `/supplier-payment-runs/${paymentRunId}/approve` },
    { method: 'POST', path: `/supplier-payment-runs/${paymentRunId}/execute` },
    { method: 'DELETE', path: `/supplier-payment-runs/${paymentRunId}` },
    {
      method: 'POST',
      path: '/supplier-statement-lines',
      body: {
        company_id: companyId,
        supplier_id: supplierId,
        statement_date: '2026-06-30',
        line_date: '2026-06-05',
        line_type: 'invoice',
        amount: 100,
      },
    },
    { method: 'GET', path: `/supplier-statement-lines?company_id=${companyId}` },
    { method: 'GET', path: `/supplier-statement-lines/${statementLineId}` },
    {
      method: 'PATCH',
      path: `/supplier-statement-lines/${statementLineId}`,
      body: { amount: 110 },
    },
    {
      method: 'PATCH',
      path: `/supplier-statement-lines/${statementLineId}/confirm-match`,
      body: { matched_bill_id: billId },
    },
    { method: 'DELETE', path: `/supplier-statement-lines/${statementLineId}` },
    {
      method: 'POST',
      path: '/public-holidays',
      body: {
        company_id: companyId,
        holiday_date: '2026-12-02',
        description: 'Auth probe holiday',
      },
    },
    { method: 'GET', path: `/public-holidays?company_id=${companyId}` },
    {
      method: 'PATCH',
      path: `/public-holidays/${publicHolidayId}`,
      body: { holiday_date: '2026-12-03' },
    },
    { method: 'DELETE', path: `/public-holidays/${publicHolidayId}` },
    {
      method: 'POST',
      path: '/credit-notes',
      body: {
        company_id: companyId,
        original_invoice_id: invoiceId,
        credit_note_date: '2026-07-01',
        lines: [
          {
            line_number: 1,
            description: 'Credit',
            quantity: 1,
            unit_price: 10,
            original_invoice_line_id: invoiceLineId,
          },
        ],
      },
    },
    { method: 'GET', path: `/credit-notes?company_id=${companyId}` },
    { method: 'GET', path: `/credit-notes/${creditNoteId}` },
    { method: 'PATCH', path: `/credit-notes/${creditNoteId}`, body: { credit_note_date: '2026-07-02' } },
    { method: 'DELETE', path: `/credit-notes/${creditNoteId}` },
    { method: 'POST', path: `/credit-notes/${creditNoteId}/issue` },
    { method: 'POST', path: `/credit-notes/${creditNoteId}/void`, body: { void_reason: 'Auth probe' } },
    {
      method: 'POST',
      path: '/credit-note-lines',
      body: {
        credit_note_id: creditNoteId,
        line_number: 1,
        description: 'Line',
        quantity: 1,
        unit_price: 10,
        original_invoice_line_id: invoiceLineId,
      },
    },
    { method: 'PATCH', path: `/credit-note-lines/${creditNoteLineId}`, body: { quantity: 2 } },
    { method: 'DELETE', path: `/credit-note-lines/${creditNoteLineId}` },
    {
      method: 'POST',
      path: '/accounting-periods',
      body: {
        company_id: companyId,
        period_start: '2026-01-01',
        period_end: '2026-01-31',
        fiscal_year: 2026,
      },
    },
    { method: 'GET', path: `/accounting-periods?company_id=${companyId}` },
    { method: 'GET', path: `/accounting-periods/${periodId}` },
    { method: 'PATCH', path: `/accounting-periods/${periodId}`, body: { fiscal_year: 2027 } },
    { method: 'POST', path: `/accounting-periods/${periodId}/soft-close`, body: {} },
    {
      method: 'POST',
      path: '/journal-entries',
      body: {
        company_id: companyId,
        period_id: periodId,
        entry_date: '2026-01-10',
        narration: 'Auth coverage probe',
        lines: [
          { line_number: 1, account_id: accountId, debit: 1, credit: 0 },
          { line_number: 2, account_id: accountId, debit: 0, credit: 1 },
        ],
      },
    },
    {
      method: 'POST',
      path: '/journal-entries/opening-balance',
      body: {
        company_id: companyId,
        fiscal_year: 2026,
        entry_date: '2026-01-01',
        narration: 'Auth coverage opening',
        lines: [
          { line_number: 1, account_id: accountId, debit: 1, credit: 0 },
          { line_number: 2, account_id: accountId, debit: 0, credit: 1 },
        ],
      },
    },
    {
      method: 'POST',
      path: '/journal-entries/year-end-close',
      body: { company_id: companyId, fiscal_year: 2026 },
    },
    {
      method: 'POST',
      path: '/journal-entries/accrue-unbilled-receipts',
      body: { company_id: companyId, period_end_date: '2026-01-31' },
    },
    { method: 'GET', path: `/journal-entries?company_id=${companyId}` },
    { method: 'GET', path: `/journal-entries/${entryId}` },
    { method: 'GET', path: `/journal-entries/${entryId}/attachments` },
    { method: 'PATCH', path: `/journal-entries/${entryId}`, body: { narration: 'revised' } },
    { method: 'POST', path: `/journal-entries/${entryId}/post`, body: {} },
    { method: 'POST', path: `/journal-entries/${entryId}/approve`, body: {} },
    {
      method: 'POST',
      path: `/journal-entries/${entryId}/reject`,
      body: { rejection_reason: 'Auth coverage reject' },
    },
    { method: 'POST', path: `/journal-entries/${entryId}/reverse` },
    { method: 'DELETE', path: `/journal-entries/${entryId}` },
    {
      method: 'POST',
      path: '/recurring-journal-templates',
      body: {
        company_id: companyId,
        template_name: 'Auth coverage template',
        narration_template: 'Probe',
        frequency: 'monthly',
        start_date: '2026-01-01',
        lines: [
          { line_number: 1, account_id: accountId, debit: 1, credit: 0 },
          { line_number: 2, account_id: accountId, debit: 0, credit: 1 },
        ],
      },
    },
    { method: 'POST', path: '/recurring-journal-templates/run-due', body: { company_id: companyId } },
    { method: 'GET', path: `/recurring-journal-templates?company_id=${companyId}` },
    { method: 'GET', path: `/recurring-journal-templates/${templateId}` },
    { method: 'PATCH', path: `/recurring-journal-templates/${templateId}`, body: {} },
    { method: 'DELETE', path: `/recurring-journal-templates/${templateId}` },
    {
      method: 'POST',
      path: `/recurring-journal-templates/${templateId}/lines`,
      body: {
        line_number: 1,
        account_id: accountId,
        debit: 1,
        credit: 0,
      },
    },
    { method: 'POST', path: `/recurring-journal-templates/${templateId}/generate`, body: {} },
    { method: 'PATCH', path: `/recurring-journal-template-lines/${templateLineId}`, body: {} },
    { method: 'DELETE', path: `/recurring-journal-template-lines/${templateLineId}` },
    { method: 'GET', path: `/audit-log?company_id=${companyId}` },
    {
      method: 'POST',
      path: '/journal-lines',
      body: {
        journal_entry_id: entryId,
        line_number: 1,
        account_id: accountId,
        debit: 1,
        credit: 0,
      },
    },
    { method: 'PATCH', path: `/journal-lines/${journalLineId}`, body: { debit: 1 } },
    { method: 'DELETE', path: `/journal-lines/${journalLineId}` },
  ];

  beforeAll(async () => {
    getUser = jest.fn();
    resolveRole = jest.fn().mockResolvedValue(CompanyRole.Owner);
    resolveCompanyIdForResource = jest.fn().mockResolvedValue(companyId);

    const accountsService = {
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: accountId }),
      create: jest.fn().mockResolvedValue({ id: accountId }),
      update: jest.fn().mockResolvedValue({ id: accountId }),
      deactivate: jest.fn().mockResolvedValue({ id: accountId }),
      remove: jest.fn().mockResolvedValue(undefined),
      getTrialBalance: jest.fn().mockResolvedValue({
        account_id: accountId,
        total_debit: 0,
        total_credit: 0,
        balance: 0,
      }),
    };

    const customersService = {
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: customerId }),
      create: jest.fn().mockResolvedValue({ id: customerId }),
      update: jest.fn().mockResolvedValue({ id: customerId }),
      deactivate: jest.fn().mockResolvedValue({ id: customerId, is_active: false }),
    };

    const quotationsService = {
      create: jest.fn().mockResolvedValue({ quotation: { id: quotationId }, lines: [] }),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ quotation: { id: quotationId }, lines: [] }),
      update: jest.fn().mockResolvedValue({ quotation: { id: quotationId }, lines: [] }),
      remove: jest.fn().mockResolvedValue(undefined),
      send: jest.fn().mockResolvedValue({ quotation: { id: quotationId }, lines: [] }),
      markViewed: jest.fn().mockResolvedValue({ quotation: { id: quotationId }, lines: [] }),
      accept: jest.fn().mockResolvedValue({ quotation: { id: quotationId }, lines: [] }),
      decline: jest.fn().mockResolvedValue({ quotation: { id: quotationId }, lines: [] }),
      convert: jest.fn().mockResolvedValue({ invoice: { id: invoiceId }, lines: [] }),
      createLine: jest.fn().mockResolvedValue({ id: quotationLineId }),
      updateLine: jest.fn().mockResolvedValue({ id: quotationLineId }),
      deleteLine: jest.fn().mockResolvedValue(undefined),
    };

    const invoicesService = {
      create: jest.fn().mockResolvedValue({ invoice: { id: invoiceId }, lines: [] }),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ invoice: { id: invoiceId }, lines: [] }),
      update: jest.fn().mockResolvedValue({ invoice: { id: invoiceId }, lines: [] }),
      remove: jest.fn().mockResolvedValue(undefined),
      issue: jest.fn().mockResolvedValue({
        invoice: { id: invoiceId, journal_entry_id: '00000000-0000-0000-0000-000000000099' },
        lines: [],
      }),
      void: jest.fn().mockResolvedValue({
        invoice: { id: invoiceId, status: 'void' },
        lines: [],
        ledger_reversal_status: 'reversed',
      }),
      send: jest.fn().mockResolvedValue({ invoice: { id: invoiceId }, lines: [] }),
      markViewed: jest.fn().mockResolvedValue({ invoice: { id: invoiceId }, lines: [] }),
      writeOff: jest.fn().mockResolvedValue({ invoice: { id: invoiceId }, lines: [] }),
      setDebtorNotified: jest.fn().mockResolvedValue({
        invoice_id: invoiceId,
        debtor_notified_at: '2026-06-01',
      }),
      createLine: jest.fn().mockResolvedValue({ id: invoiceLineId }),
      updateLine: jest.fn().mockResolvedValue({ id: invoiceLineId }),
      deleteLine: jest.fn().mockResolvedValue(undefined),
    };

    const paymentsService = {
      create: jest.fn().mockResolvedValue({ payment: { id: paymentId }, applications: [] }),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ payment: { id: paymentId }, applications: [] }),
      update: jest.fn().mockResolvedValue({ payment: { id: paymentId }, applications: [] }),
      remove: jest.fn().mockResolvedValue(undefined),
      post: jest.fn().mockResolvedValue({ payment: { id: paymentId }, applications: [] }),
      createApplication: jest.fn().mockResolvedValue({ id: paymentApplicationId }),
      deleteApplication: jest.fn().mockResolvedValue(undefined),
      postAdvanceApplication: jest.fn().mockResolvedValue({
        application: { id: paymentApplicationId },
        journal_entry_id: '00000000-0000-0000-0000-000000000097',
      }),
    };

    const publicHolidaysService = {
      findAll: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: publicHolidayId }),
      update: jest.fn().mockResolvedValue({ id: publicHolidayId, status: 'CONFIRMED' }),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    const creditNotesService = {
      create: jest.fn().mockResolvedValue({ credit_note: { id: creditNoteId }, lines: [] }),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ credit_note: { id: creditNoteId }, lines: [] }),
      update: jest.fn().mockResolvedValue({ credit_note: { id: creditNoteId }, lines: [] }),
      remove: jest.fn().mockResolvedValue(undefined),
      issue: jest.fn().mockResolvedValue({
        credit_note: { id: creditNoteId, journal_entry_id: '00000000-0000-0000-0000-000000000098' },
        lines: [],
      }),
      void: jest.fn().mockResolvedValue({
        credit_note: { id: creditNoteId, status: 'void' },
        lines: [],
        ledger_reversal_status: 'reversed',
      }),
      createLine: jest.fn().mockResolvedValue({ id: creditNoteLineId }),
      updateLine: jest.fn().mockResolvedValue({ id: creditNoteLineId }),
      deleteLine: jest.fn().mockResolvedValue(undefined),
    };

    const accountingPeriodsService = {
      create: jest.fn().mockResolvedValue({ id: periodId }),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: periodId }),
      update: jest.fn().mockResolvedValue({ id: periodId }),
      softClose: jest.fn().mockResolvedValue({ id: periodId }),
    };

    const journalEntriesService = {
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(journalEntryDetails),
      getAttachments: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(journalEntryDetails),
      create: jest.fn().mockResolvedValue(journalEntryDetails),
      createOpeningBalance: jest.fn().mockResolvedValue(journalEntryDetails),
      runYearEndClosing: jest.fn().mockResolvedValue(journalEntryDetails),
      accrueUnbilledReceipts: jest.fn().mockResolvedValue({ accrual_amount: 0 }),
      post: jest.fn().mockResolvedValue(journalEntryDetails),
      approve: jest.fn().mockResolvedValue(journalEntryDetails),
      reject: jest.fn().mockResolvedValue(journalEntryDetails),
      reverse: jest.fn().mockResolvedValue({
        ...journalEntryDetails,
        reversal: journalEntryDetails,
      }),
      createLine: jest.fn().mockResolvedValue({
        id: journalLineId,
        journal_entry_id: entryId,
        line_number: 1,
        account_id: accountId,
        debit: 1,
        credit: 0,
      }),
      updateLine: jest.fn().mockResolvedValue({ id: journalLineId }),
      deleteLine: jest.fn().mockResolvedValue(undefined),
      deleteEntry: jest.fn().mockResolvedValue(undefined),
    };

    const recurringService = {
      create: jest.fn().mockResolvedValue({
        template: { id: templateId, company_id: companyId },
        lines: [],
      }),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({
        template: { id: templateId, company_id: companyId },
        lines: [],
      }),
      update: jest.fn().mockResolvedValue({ id: templateId }),
      remove: jest.fn().mockResolvedValue(undefined),
      addLine: jest.fn().mockResolvedValue({ id: templateLineId }),
      generateTemplate: jest.fn().mockResolvedValue({
        template_id: templateId,
      }),
      runDueGenerations: jest.fn().mockResolvedValue([]),
      updateLine: jest.fn().mockResolvedValue({ id: templateLineId }),
      removeLine: jest.fn().mockResolvedValue(undefined),
    };

    const auditLogService = {
      find: jest.fn().mockResolvedValue([]),
    };

    const reportsService = {
      getTrialBalance: jest.fn().mockResolvedValue([]),
      getBalanceSheet: jest.fn().mockResolvedValue({
        as_of_date: '2026-01-31',
        accounts: [],
        total_assets: 0,
        total_liabilities: 0,
        total_equity: 0,
        is_balanced: true,
      }),
      getProfitAndLoss: jest.fn().mockResolvedValue({
        period_start: '2026-01-01',
        period_end: '2026-01-31',
        accounts: [],
        total_income: 0,
        total_expense: 0,
        net_profit: 0,
      }),
      getGeneralLedger: jest.fn().mockResolvedValue([]),
      getTrialBalanceForRange: jest.fn().mockResolvedValue([]),
      getProfitAndLossComparison: jest.fn().mockResolvedValue({
        period_a: {
          period_start: '2026-01-01',
          period_end: '2026-01-31',
          accounts: [],
          total_income: 0,
          total_expense: 0,
          net_profit: 0,
        },
        period_b: {
          period_start: '2025-12-01',
          period_end: '2025-12-31',
          accounts: [],
          total_income: 0,
          total_expense: 0,
          net_profit: 0,
        },
        accounts: [],
      }),
      getExpenseAnalysis: jest.fn().mockResolvedValue([]),
      getSalesByCustomer: jest.fn().mockResolvedValue([]),
      getExecutiveSummary: jest.fn().mockResolvedValue({
        period_start: '2026-01-01',
        period_end: '2026-01-31',
        as_of_date: '2026-01-31',
        total_assets: 0,
        total_liabilities: 0,
        total_equity: 0,
        is_balanced: true,
        net_profit: 0,
        total_ar_outstanding: 0,
        total_ap_outstanding: 0,
        drilldown: {
          balance_sheet: { as_of_date: '2026-01-31' },
          profit_and_loss: { period_start: '2026-01-01', period_end: '2026-01-31' },
          aged_receivables: { as_of_date: '2026-01-31' },
          aged_payables: { as_of_date: '2026-01-31' },
        },
      }),
      getAuditPack: jest.fn().mockResolvedValue({}),
      getCustomerLedger: jest.fn().mockResolvedValue([]),
      getCustomerStatement: jest.fn().mockResolvedValue([]),
      getAgedReceivables: jest.fn().mockResolvedValue([]),
      checkCustomerCreditLimit: jest.fn().mockResolvedValue({
        customer_id: customerId,
        credit_limit: null,
        open_invoice_outstanding: 0,
        unapplied_advance_credit: 0,
        outstanding_balance: 0,
        exceeds_credit_limit: false,
        alert: null,
      }),
      getCustomerPaymentHistory: jest.fn().mockResolvedValue({
        customer_id: customerId,
        invoice_count: 0,
        average_actual_days_to_pay: null,
        average_terms_days: null,
        invoices: [],
      }),
      getSupplierLedger: jest.fn().mockResolvedValue([]),
      getAgedPayables: jest.fn().mockResolvedValue([]),
      getBillsDue: jest.fn().mockResolvedValue([]),
      reconcileSupplierStatement: jest.fn().mockResolvedValue({}),
      getInvoiceRegister: jest.fn().mockResolvedValue([]),
      getVatRegistrationThreshold: jest.fn().mockResolvedValue({}),
      assembleVatAuditPack: jest.fn().mockResolvedValue({}),
    };

    const apStub = {
      create: jest.fn().mockResolvedValue({ id: supplierId }),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: supplierId }),
      update: jest.fn().mockResolvedValue({ id: supplierId }),
      deactivate: jest.fn().mockResolvedValue({ id: supplierId }),
      remove: jest.fn().mockResolvedValue(undefined),
      createLine: jest.fn().mockResolvedValue({ id: purchaseOrderLineId }),
      updateLine: jest.fn().mockResolvedValue({ id: purchaseOrderLineId }),
      deleteLine: jest.fn().mockResolvedValue(undefined),
      match: jest.fn().mockResolvedValue({ bill: { id: billId }, lines: [] }),
      issue: jest.fn().mockResolvedValue({ bill: { id: billId }, lines: [] }),
      approve: jest.fn().mockResolvedValue({ bill: { id: billId }, lines: [] }),
      overrideMatchBlock: jest.fn().mockResolvedValue({ bill: { id: billId }, lines: [] }),
      void: jest.fn().mockResolvedValue({
        bill: { id: billId },
        lines: [],
        ledger_reversal_status: 'reversed',
      }),
      schedule: jest.fn().mockResolvedValue({ bill: { id: billId }, lines: [] }),
      dispute: jest.fn().mockResolvedValue({ bill: { id: billId }, lines: [] }),
      createPayment: jest.fn().mockResolvedValue({ payment: { id: supplierPaymentId }, applications: [] }),
      findAllPayments: jest.fn().mockResolvedValue([]),
      findPayment: jest.fn().mockResolvedValue({ payment: { id: supplierPaymentId }, applications: [] }),
      updatePayment: jest.fn().mockResolvedValue({ payment: { id: supplierPaymentId }, applications: [] }),
      removePayment: jest.fn().mockResolvedValue(undefined),
      postPayment: jest.fn().mockResolvedValue({ payment: { id: supplierPaymentId }, applications: [] }),
      createApplication: jest.fn().mockResolvedValue({ id: supplierPaymentAppId }),
      deleteApplication: jest.fn().mockResolvedValue(undefined),
      postAdvanceApplication: jest.fn().mockResolvedValue({
        application: { id: supplierPaymentAppId },
        journal_entry_id: '00000000-0000-0000-0000-000000000096',
      }),
      createRun: jest.fn().mockResolvedValue({ run: { id: paymentRunId }, items: [] }),
      findAllRuns: jest.fn().mockResolvedValue([]),
      findRun: jest.fn().mockResolvedValue({ run: { id: paymentRunId }, items: [] }),
      updateRunHeader: jest.fn().mockResolvedValue({ run: { id: paymentRunId }, items: [] }),
      cancelRun: jest.fn().mockResolvedValue({ run: { id: paymentRunId }, items: [] }),
      approveRun: jest.fn().mockResolvedValue({ run: { id: paymentRunId }, items: [] }),
      executeRun: jest.fn().mockResolvedValue({ payments: [], skipped: [] }),
      removeRun: jest.fn().mockResolvedValue(undefined),
      createStatementLine: jest.fn().mockResolvedValue({ id: statementLineId }),
      findAllStatementLines: jest.fn().mockResolvedValue([]),
      findStatementLine: jest.fn().mockResolvedValue({ id: statementLineId }),
      updateStatementLine: jest.fn().mockResolvedValue({ id: statementLineId }),
      confirmStatementMatch: jest.fn().mockResolvedValue({ id: statementLineId, match_status: 'matched' }),
      removeStatementLine: jest.fn().mockResolvedValue(undefined),
    };

    const vatService = {
      calculate: jest.fn().mockResolvedValue({ id: vatReturnId }),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: vatReturnId }),
      groupTransactions: jest.fn().mockResolvedValue([]),
      submitForReview: jest.fn().mockResolvedValue({ id: vatReturnId }),
      approve: jest.fn().mockResolvedValue({ id: vatReturnId }),
      file: jest.fn().mockResolvedValue({ id: vatReturnId }),
      export: jest.fn().mockResolvedValue({}),
      reconcile: jest.fn().mockResolvedValue({}),
      claimRefund: jest.fn().mockResolvedValue({}),
      recordPayment: jest.fn().mockResolvedValue({}),
      accruePenalty: jest.fn().mockResolvedValue({}),
      createCorrection: jest.fn().mockResolvedValue({}),
      calculateApportionment: jest.fn().mockResolvedValue({}),
      createProject: jest.fn().mockResolvedValue({ id: capitalGoodsProjectId }),
      listProjects: jest.fn().mockResolvedValue([]),
      findProject: jest.fn().mockResolvedValue({ id: capitalGoodsProjectId }),
      updateProject: jest.fn().mockResolvedValue({ id: capitalGoodsProjectId }),
      deleteProject: jest.fn().mockResolvedValue(undefined),
      createItem: jest.fn().mockResolvedValue({ id: capitalGoodsItemId }),
      listItems: jest.fn().mockResolvedValue([]),
      findItem: jest.fn().mockResolvedValue({ id: capitalGoodsItemId }),
      updateItem: jest.fn().mockResolvedValue({ id: capitalGoodsItemId }),
      deleteItem: jest.fn().mockResolvedValue(undefined),
      adjustItem: jest.fn().mockResolvedValue({}),
      createClaim: jest.fn().mockResolvedValue({ id: vatClaimId }),
      listClaims: jest.fn().mockResolvedValue([]),
      claimRelief: jest.fn().mockResolvedValue({}),
      listDisclosures: jest.fn().mockResolvedValue([]),
      findDisclosure: jest.fn().mockResolvedValue({ id: vatVdId }),
      approveDisclosure: jest.fn().mockResolvedValue({}),
    };

    const suppliersService = apStub;
    const purchaseOrdersService = apStub;
    const goodsReceiptsService = apStub;
    const billsService = apStub;
    const supplierPaymentsService = apStub;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [
        AccountsController,
        CustomersController,
        QuotationsController,
        QuotationLinesController,
        InvoicesController,
        InvoiceLinesController,
        PaymentsController,
        PaymentApplicationsController,
        PublicHolidaysController,
        CreditNotesController,
        CreditNoteLinesController,
        AccountingPeriodsController,
        JournalEntriesController,
        JournalLinesController,
        RecurringJournalTemplatesController,
        RecurringJournalTemplateLinesController,
        AuditLogController,
        ReportsController,
        SuppliersController,
        PurchaseOrdersController,
        GoodsReceiptsController,
        BillsController,
        SupplierPaymentsController,
        SupplierPaymentRunsController,
        SupplierStatementLinesController,
        VatReturnsController,
        VatApportionmentController,
        CapitalGoodsProjectsController,
        CapitalGoodsItemsController,
        BadDebtReliefClaimsController,
        VatVoluntaryDisclosuresController,
        CtController,
      ],
      providers: [
        SupabaseAuthGuard,
        CompanyMembershipGuard,
        { provide: AccountsService, useValue: accountsService },
        { provide: CustomersService, useValue: customersService },
        { provide: QuotationsService, useValue: quotationsService },
        { provide: InvoicesService, useValue: invoicesService },
        { provide: PaymentsService, useValue: paymentsService },
        { provide: PublicHolidaysService, useValue: publicHolidaysService },
        { provide: CreditNotesService, useValue: creditNotesService },
        { provide: AccountingPeriodsService, useValue: accountingPeriodsService },
        { provide: JournalEntriesService, useValue: journalEntriesService },
        { provide: RecurringJournalTemplatesService, useValue: recurringService },
        { provide: AuditLogService, useValue: auditLogService },
        { provide: ReportsService, useValue: reportsService },
        { provide: VatService, useValue: vatService },
        {
          provide: CtService,
          useValue: {
            taxableProfit: jest.fn().mockResolvedValue({}),
            calculate: jest.fn().mockResolvedValue({}),
            postProvision: jest.fn().mockResolvedValue({}),
            listProvisions: jest.fn().mockResolvedValue([]),
            sbrEligibility: jest.fn().mockResolvedValue({}),
            createIncomeAdjustment: jest.fn().mockResolvedValue({}),
            freeZoneSummary: jest.fn().mockResolvedValue({}),
            recordRelatedParty: jest.fn().mockResolvedValue({}),
            listRelatedParty: jest.fn().mockResolvedValue([]),
            returnSummary: jest.fn().mockResolvedValue({}),
            registrationStatus: jest.fn().mockResolvedValue({ trn: null }),
            penaltyExposure: jest.fn().mockResolvedValue({}),
          },
        },
        { provide: SuppliersService, useValue: suppliersService },
        { provide: PurchaseOrdersService, useValue: purchaseOrdersService },
        { provide: GoodsReceiptsService, useValue: goodsReceiptsService },
        { provide: BillsService, useValue: billsService },
        { provide: SupplierPaymentsService, useValue: supplierPaymentsService },
        {
          provide: SupabaseService,
          useValue: {
            client: {
              auth: { getUser },
            },
          },
        },
        {
          provide: CompanyMembersService,
          useValue: {
            resolveRole,
            resolveCompanyIdForResource,
            resolveRoleForJournalEntry: jest.fn(),
          },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    getUser.mockReset();
    resolveRole.mockReset().mockResolvedValue(CompanyRole.Owner);
    resolveCompanyIdForResource.mockReset().mockResolvedValue(companyId);
  });

  async function request(
    method: string,
    path: string,
    options?: { token?: string; body?: unknown },
  ): Promise<{ status: number; body: string }> {
    const headers: Record<string, string> = {};
    if (options?.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }
    let body: string | undefined;
    if (options?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const response = await fetch(`${baseUrl}${path}`, { method, headers, body });
    return { status: response.status, body: await response.text() };
  }

  it('covers all guarded HTTP routes', () => {
    expect(ALL_GUARDED_ROUTES).toHaveLength(218);
  });

  it.each(ALL_GUARDED_ROUTES)(
    'unauthenticated $method $path returns 401',
    async ({ method, path, body }) => {
      getUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
      const result = await request(method, path, { body });
      expect(result.status).toBe(401);
    },
  );

  it.each(ALL_GUARDED_ROUTES)(
    'authenticated $method $path reaches handler (not 401/403)',
    async ({ method, path, body }) => {
      getUser.mockResolvedValue({
        data: { user: { id: sessionUserId } },
        error: null,
      });

      const result = await request(method, path, { token: 'valid-session-token', body });
      expect(result.status).not.toBe(401);
      expect(result.status).not.toBe(403);
      expect(getUser).toHaveBeenCalledWith('valid-session-token');
      expect(resolveRole).toHaveBeenCalled();
    },
  );

  it('SupabaseAuthGuard still rejects missing bearer (unit)', async () => {
    const guard = app.get(SupabaseAuthGuard);
    await expect(
      guard.canActivate({
        switchToHttp: () => ({
          getRequest: () => ({ headers: {} }),
        }),
      } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
