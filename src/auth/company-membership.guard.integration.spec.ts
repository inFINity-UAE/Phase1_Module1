import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import {
  INestApplication,
  ValidationPipe,
  type Type,
} from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { createClient } from '@supabase/supabase-js';
import { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { AppModule } from '../app.module';
import { AccountsController } from '../accounts/accounts.controller';
import { CustomersController } from '../customers/customers.controller';
import { QuotationsController } from '../quotations/quotations.controller';
import { QuotationLinesController } from '../quotations/quotation-lines.controller';
import { InvoicesController } from '../invoices/invoices.controller';
import { InvoiceLinesController } from '../invoices/invoice-lines.controller';
import { PaymentsController } from '../payments/payments.controller';
import { PaymentApplicationsController } from '../payments/payment-applications.controller';
import { PublicHolidaysController } from '../public-holidays/public-holidays.controller';
import { AccountingPeriodsController } from '../accounting-periods/accounting-periods.controller';
import { AuditLogController } from '../audit-log/audit-log.controller';
import { JournalEntriesController } from '../journal-entries/journal-entries.controller';
import { JournalLinesController } from '../journal-entries/journal-lines.controller';
import {
  RecurringJournalTemplateLinesController,
  RecurringJournalTemplatesController,
} from '../recurring-journal-templates/recurring-journal-templates.controller';
import { ReportsController } from '../reports/reports.controller';
import { SuppliersController } from '../suppliers/suppliers.controller';
import { PurchaseOrdersController } from '../purchase-orders/purchase-orders.controller';
import { GoodsReceiptsController } from '../goods-receipts/goods-receipts.controller';
import { BillsController } from '../bills/bills.controller';
import { SupplierPaymentsController } from '../supplier-payments/supplier-payments.controller';
import { SupplierPaymentRunsController } from '../supplier-payments/supplier-payment-runs.controller';
import { SupplierStatementLinesController } from '../supplier-payments/supplier-statement-lines.controller';
import { REQUIRE_COMPANY_MEMBERSHIP_KEY } from '../auth/decorators/require-company-membership.decorator';
import { SupabaseService } from '../database/supabase.service';
import { CompanyRole } from '../common/enums/company-role.enum';
import {
  ensureAuthUser,
  ensureCompanyMember,
  testUserEmail,
  testUserPassword,
} from '../test/company-members.setup';
import {
  INTEGRATION_USER_ID,
  mintFreshIntegrationCompany,
} from '../test/integration-company.setup';
import { DatabaseModule } from '../database/database.module';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const HTTP_CONTROLLERS: Type[] = [
  AccountsController,
  CustomersController,
  QuotationsController,
  QuotationLinesController,
  InvoicesController,
  InvoiceLinesController,
  PaymentsController,
  PaymentApplicationsController,
  PublicHolidaysController,
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
];

/**
 * [feature-spec.md decision #41] Completeness + live 403/member probes for
 * CompanyMembershipGuard on every tenant-scoped route.
 */
(hasSupabase ? describe : describe.skip)(
  'Company membership enforcement (decision #41)',
  () => {
    jest.setTimeout(240_000);

    let app: INestApplication;
    let baseUrl: string;
    let supabase: SupabaseService;
    let accessToken = '';
    let memberCompanyId = '';
    let foreignCompanyId = '';
    let foreignAccountId = '';
    let foreignPeriodId = '';
    let foreignEntryId = '';
    let foreignLineId = '';
    let foreignTemplateId = '';
    let foreignTemplateLineId = '';
    let foreignCustomerId = '';
    let foreignInvoiceId = '';
    let foreignInvoiceLineId = '';
    let foreignPaymentId = '';
    let foreignPaymentApplicationId = '';
    let foreignPublicHolidayId = '';
    let foreignSupplierId = '';
    let foreignPurchaseOrderId = '';
    let foreignGoodsReceiptId = '';
    let foreignBillId = '';
    let foreignSupplierPaymentId = '';
    let foreignPaymentRunId = '';
    let foreignStatementLineId = '';
    let memberAccountId = '';

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = module.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: true },
        }),
      );
      await app.init();
      await app.listen(0);
      const address = app.getHttpServer().address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;

      const dbModule: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule],
      }).compile();
      supabase = dbModule.get(SupabaseService);

      await ensureAuthUser(
        supabase,
        INTEGRATION_USER_ID,
        testUserEmail(INTEGRATION_USER_ID),
      );

      memberCompanyId = await mintFreshIntegrationCompany(
        supabase,
        'Membership member',
      );
      foreignCompanyId = await mintFreshIntegrationCompany(
        supabase,
        'Membership foreign',
      );

      // INTEGRATION_USER is Owner on both mints — strip foreign membership.
      const { error: delMemErr } = await supabase.client
        .from('company_members')
        .delete()
        .eq('company_id', foreignCompanyId)
        .eq('user_id', INTEGRATION_USER_ID);
      if (delMemErr) {
        throw delMemErr;
      }

      const { data: memberAccounts, error: maErr } = await supabase.client
        .from('accounts')
        .select('id')
        .eq('company_id', memberCompanyId)
        .eq('account_number', '1010')
        .single();
      if (maErr || !memberAccounts) {
        throw maErr ?? new Error('member cash account missing');
      }
      memberAccountId = memberAccounts.id as string;

      const { data: foreignAccounts, error: faErr } = await supabase.client
        .from('accounts')
        .select('id')
        .eq('company_id', foreignCompanyId)
        .eq('account_number', '1010')
        .single();
      if (faErr || !foreignAccounts) {
        throw faErr ?? new Error('foreign cash account missing');
      }
      foreignAccountId = foreignAccounts.id as string;

      const { data: foreignPeriod, error: fpErr } = await supabase.client
        .from('accounting_periods')
        .select('id')
        .eq('company_id', foreignCompanyId)
        .eq('period_start', '2026-01-01')
        .single();
      if (fpErr || !foreignPeriod) {
        throw fpErr ?? new Error('foreign period missing');
      }
      foreignPeriodId = foreignPeriod.id as string;

      const { data: foreignBank, error: fbErr } = await supabase.client
        .from('accounts')
        .select('id')
        .eq('company_id', foreignCompanyId)
        .eq('account_number', '1020')
        .single();
      if (fbErr || !foreignBank) {
        throw fbErr ?? new Error('foreign bank account missing');
      }

      // Seed foreign draft entry + line + recurring template via service_role
      const { data: entry, error: entryErr } = await supabase.client
        .from('journal_entries')
        .insert({
          company_id: foreignCompanyId,
          entry_number: 1,
          period_id: foreignPeriodId,
          entry_date: '2026-01-15',
          entry_type: 'manual',
          status: 'draft',
          narration: 'foreign draft for membership probe',
          created_by: INTEGRATION_USER_ID,
        })
        .select('id')
        .single();
      if (entryErr || !entry) {
        throw entryErr ?? new Error('foreign entry insert failed');
      }
      foreignEntryId = entry.id as string;

      const { data: line, error: lineErr } = await supabase.client
        .from('journal_lines')
        .insert({
          journal_entry_id: foreignEntryId,
          line_number: 1,
          account_id: foreignAccountId,
          debit: 10,
          credit: 0,
        })
        .select('id')
        .single();
      if (lineErr || !line) {
        throw lineErr ?? new Error('foreign line insert failed');
      }
      foreignLineId = line.id as string;

      const { data: template, error: tplErr } = await supabase.client
        .from('recurring_journal_templates')
        .insert({
          company_id: foreignCompanyId,
          template_name: `foreign-tpl-${randomUUID()}`,
          narration_template: 'foreign',
          frequency: 'monthly',
          start_date: '2026-01-01',
          next_run_date: '2026-02-01',
          created_by: INTEGRATION_USER_ID,
        })
        .select('id')
        .single();
      if (tplErr || !template) {
        throw tplErr ?? new Error('foreign template insert failed');
      }
      foreignTemplateId = template.id as string;

      const { data: tplLine, error: tplLineErr } = await supabase.client
        .from('recurring_journal_template_lines')
        .insert({
          template_id: foreignTemplateId,
          line_number: 1,
          account_id: foreignAccountId,
          debit: 1,
          credit: 0,
        })
        .select('id')
        .single();
      if (tplLineErr || !tplLine) {
        throw tplLineErr ?? new Error('foreign template line insert failed');
      }
      foreignTemplateLineId = tplLine.id as string;

      const { data: foreignCustomer, error: custErr } = await supabase.client
        .from('customers')
        .insert({
          company_id: foreignCompanyId,
          customer_name: `foreign-customer-${randomUUID()}`,
          trn: null,
        })
        .select('id')
        .single();
      if (custErr || !foreignCustomer) {
        throw custErr ?? new Error('foreign customer insert failed');
      }
      foreignCustomerId = foreignCustomer.id as string;

      const { data: foreignInvoice, error: invErr } = await supabase.client
        .from('invoices')
        .insert({
          company_id: foreignCompanyId,
          customer_id: foreignCustomerId,
          invoice_date: '2026-06-01',
          payment_terms: 'net_30',
          status: 'draft',
          created_by: INTEGRATION_USER_ID,
        })
        .select('id')
        .single();
      if (invErr || !foreignInvoice) {
        throw invErr ?? new Error('foreign invoice insert failed');
      }
      foreignInvoiceId = foreignInvoice.id as string;

      const { data: foreignInvoiceLine, error: invLineErr } = await supabase.client
        .from('invoice_lines')
        .insert({
          invoice_id: foreignInvoiceId,
          line_number: 1,
          description: 'foreign probe line',
          quantity: 1,
          unit_price: 100,
          vat_rate: 5,
        })
        .select('id')
        .single();
      if (invLineErr || !foreignInvoiceLine) {
        throw invLineErr ?? new Error('foreign invoice line insert failed');
      }
      foreignInvoiceLineId = foreignInvoiceLine.id as string;

      // Issued-enough for payment_applications trigger; auth probe only needs rows.
      await supabase.client
        .from('invoices')
        .update({
          status: 'issued',
          grand_total: 105,
          amount_paid: 0,
        })
        .eq('id', foreignInvoiceId);

      const { data: foreignPayment, error: payErr } = await supabase.client
        .from('payments')
        .insert({
          company_id: foreignCompanyId,
          customer_id: foreignCustomerId,
          payment_date: '2026-06-15',
          amount: 50,
          payment_method: 'bank_transfer',
          unapplied_amount: 50,
          created_by: INTEGRATION_USER_ID,
        })
        .select('id')
        .single();
      if (payErr || !foreignPayment) {
        throw payErr ?? new Error('foreign payment insert failed');
      }
      foreignPaymentId = foreignPayment.id as string;

      const { data: foreignApp, error: appErr } = await supabase.client
        .from('payment_applications')
        .insert({
          payment_id: foreignPaymentId,
          invoice_id: foreignInvoiceId,
          applied_amount: 25,
          applied_by: INTEGRATION_USER_ID,
        })
        .select('id')
        .single();
      if (appErr || !foreignApp) {
        throw appErr ?? new Error('foreign payment application insert failed');
      }
      foreignPaymentApplicationId = foreignApp.id as string;

      const { data: foreignHoliday, error: holidayErr } = await supabase.client
        .from('public_holidays')
        .insert({
          company_id: foreignCompanyId,
          holiday_date: '2099-06-01',
          description: 'Foreign company holiday',
          status: 'PROVISIONAL',
        })
        .select('id')
        .single();
      if (holidayErr || !foreignHoliday) {
        throw holidayErr ?? new Error('foreign public holiday insert failed');
      }
      foreignPublicHolidayId = foreignHoliday.id as string;

      const { data: foreignSupplier, error: supplierErr } = await supabase.client
        .from('suppliers')
        .insert({
          company_id: foreignCompanyId,
          supplier_name: `foreign-supplier-${randomUUID()}`,
        })
        .select('id')
        .single();
      if (supplierErr || !foreignSupplier) {
        throw supplierErr ?? new Error('foreign supplier insert failed');
      }
      foreignSupplierId = foreignSupplier.id as string;

      const { data: foreignPo, error: poErr } = await supabase.client
        .from('purchase_orders')
        .insert({
          company_id: foreignCompanyId,
          supplier_id: foreignSupplierId,
          po_date: '2026-06-01',
          created_by: INTEGRATION_USER_ID,
        })
        .select('id')
        .single();
      if (poErr || !foreignPo) {
        throw poErr ?? new Error('foreign purchase order insert failed');
      }
      foreignPurchaseOrderId = foreignPo.id as string;

      const { data: foreignGrn, error: grnErr } = await supabase.client
        .from('goods_receipts')
        .insert({
          company_id: foreignCompanyId,
          supplier_id: foreignSupplierId,
          purchase_order_id: foreignPurchaseOrderId,
          receipt_date: '2026-06-02',
          created_by: INTEGRATION_USER_ID,
        })
        .select('id')
        .single();
      if (grnErr || !foreignGrn) {
        throw grnErr ?? new Error('foreign goods receipt insert failed');
      }
      foreignGoodsReceiptId = foreignGrn.id as string;

      const { data: foreignBill, error: billErr } = await supabase.client
        .from('bills')
        .insert({
          company_id: foreignCompanyId,
          supplier_id: foreignSupplierId,
          bill_date: '2026-06-05',
          created_by: INTEGRATION_USER_ID,
        })
        .select('id')
        .single();
      if (billErr || !foreignBill) {
        throw billErr ?? new Error('foreign bill insert failed');
      }
      foreignBillId = foreignBill.id as string;

      const { data: foreignSpay, error: spayErr } = await supabase.client
        .from('supplier_payments')
        .insert({
          company_id: foreignCompanyId,
          supplier_id: foreignSupplierId,
          payment_date: '2026-06-15',
          amount: 50,
          payment_method: 'bank_transfer',
          created_by: INTEGRATION_USER_ID,
        })
        .select('id')
        .single();
      if (spayErr || !foreignSpay) {
        throw spayErr ?? new Error('foreign supplier payment insert failed');
      }
      foreignSupplierPaymentId = foreignSpay.id as string;

      const { data: foreignRun, error: runErr } = await supabase.client
        .from('supplier_payment_runs')
        .insert({
          company_id: foreignCompanyId,
          run_date: '2026-06-16',
          payment_method: 'bank_transfer',
          created_by: INTEGRATION_USER_ID,
        })
        .select('id')
        .single();
      if (runErr || !foreignRun) {
        throw runErr ?? new Error('foreign payment run insert failed');
      }
      foreignPaymentRunId = foreignRun.id as string;

      const { data: foreignStmt, error: stmtErr } = await supabase.client
        .from('supplier_statement_lines')
        .insert({
          company_id: foreignCompanyId,
          supplier_id: foreignSupplierId,
          statement_date: '2026-06-30',
          line_date: '2026-06-05',
          line_type: 'invoice',
          amount: 100,
        })
        .select('id')
        .single();
      if (stmtErr || !foreignStmt) {
        throw stmtErr ?? new Error('foreign statement line insert failed');
      }
      foreignStatementLineId = foreignStmt.id as string;

      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
      const userClient = createClient(url, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: login, error: loginError } = await userClient.auth.signInWithPassword({
        email: testUserEmail(INTEGRATION_USER_ID),
        password: testUserPassword(),
      });
      if (loginError || !login.session?.access_token) {
        throw loginError ?? new Error('login failed');
      }
      accessToken = login.session.access_token;

      // Sanity: user is member of member company only
      await ensureCompanyMember(
        supabase,
        memberCompanyId,
        INTEGRATION_USER_ID,
        CompanyRole.Owner,
        testUserEmail(INTEGRATION_USER_ID),
      );
    }, 240000);

    afterAll(async () => {
      await app.close();
    });

    async function http(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<{ status: number; json: unknown }> {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
      };
      let payload: string | undefined;
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: payload,
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }
      return { status: response.status, json };
    }

    it('every HTTP handler declares @RequireCompanyMembership (completeness)', () => {
      const reflector = new Reflector();
      const missing: string[] = [];

      for (const controller of HTTP_CONTROLLERS) {
        const controllerPath = Reflect.getMetadata(PATH_METADATA, controller) ?? '';
        const proto = controller.prototype as object;
        for (const key of Object.getOwnPropertyNames(proto)) {
          if (key === 'constructor') continue;
          const handler = (proto as Record<string, unknown>)[key];
          if (typeof handler !== 'function') continue;
          const method = Reflect.getMetadata(METHOD_METADATA, handler) as
            | RequestMethod
            | undefined;
          if (method === undefined) continue;
          const meta = reflector.get(REQUIRE_COMPANY_MEMBERSHIP_KEY, handler);
          if (!meta) {
            missing.push(`${controller.name}.${key} (${controllerPath})`);
          }
        }
      }

      expect(missing).toEqual([]);
    });

    it('non-member receives 403 on every company_id / resource route shape', async () => {
      const cases: Array<{ method: string; path: string; body?: unknown }> = [
        { method: 'GET', path: `/accounts?company_id=${foreignCompanyId}` },
        { method: 'GET', path: `/accounts/${foreignAccountId}` },
        {
          method: 'POST',
          path: '/accounts',
          body: {
            company_id: foreignCompanyId,
            account_number: '1998',
            account_name: 'Should fail',
            category: 'asset',
            normal_balance: 'debit',
          },
        },
        { method: 'PATCH', path: `/accounts/${foreignAccountId}`, body: { account_name: 'X' } },
        { method: 'PATCH', path: `/accounts/${foreignAccountId}/deactivate` },
        { method: 'DELETE', path: `/accounts/${foreignAccountId}` },
        { method: 'GET', path: `/accounts/${foreignAccountId}/trial-balance` },
        {
          method: 'GET',
          path: `/accounting-periods?company_id=${foreignCompanyId}`,
        },
        { method: 'GET', path: `/accounting-periods/${foreignPeriodId}` },
        {
          method: 'POST',
          path: '/accounting-periods',
          body: {
            company_id: foreignCompanyId,
            period_start: '2099-01-01',
            period_end: '2099-01-31',
            fiscal_year: 2099,
          },
        },
        {
          method: 'PATCH',
          path: `/accounting-periods/${foreignPeriodId}`,
          body: { fiscal_year: 2026 },
        },
        {
          method: 'POST',
          path: `/accounting-periods/${foreignPeriodId}/soft-close`,
          body: {},
        },
        { method: 'GET', path: `/journal-entries?company_id=${foreignCompanyId}` },
        { method: 'GET', path: `/journal-entries/${foreignEntryId}` },
        { method: 'GET', path: `/journal-entries/${foreignEntryId}/attachments` },
        {
          method: 'POST',
          path: '/journal-entries',
          body: {
            company_id: foreignCompanyId,
            period_id: foreignPeriodId,
            entry_date: '2026-01-10',
            narration: 'nope',
            lines: [
              {
                line_number: 1,
                account_id: foreignAccountId,
                debit: 1,
                credit: 0,
              },
              {
                line_number: 2,
                account_id: foreignAccountId,
                debit: 0,
                credit: 1,
              },
            ],
          },
        },
        {
          method: 'PATCH',
          path: `/journal-entries/${foreignEntryId}`,
          body: { narration: 'nope' },
        },
        { method: 'POST', path: `/journal-entries/${foreignEntryId}/post`, body: {} },
        { method: 'POST', path: `/journal-entries/${foreignEntryId}/approve`, body: {} },
        {
          method: 'POST',
          path: `/journal-entries/${foreignEntryId}/reject`,
          body: { rejection_reason: 'x' },
        },
        { method: 'POST', path: `/journal-entries/${foreignEntryId}/reverse` },
        { method: 'DELETE', path: `/journal-entries/${foreignEntryId}` },
        {
          method: 'POST',
          path: '/journal-entries/opening-balance',
          body: {
            company_id: foreignCompanyId,
            fiscal_year: 2026,
            entry_date: '2026-01-01',
            narration: 'nope',
            lines: [
              { account_id: foreignAccountId, debit: 1, credit: 0 },
              { account_id: foreignAccountId, debit: 0, credit: 1 },
            ],
          },
        },
        {
          method: 'POST',
          path: '/journal-entries/year-end-close',
          body: { company_id: foreignCompanyId, fiscal_year: 2026 },
        },
        {
          method: 'POST',
          path: '/journal-entries/accrue-unbilled-receipts',
          body: { company_id: foreignCompanyId, period_end_date: '2026-01-31' },
        },
        {
          method: 'POST',
          path: '/journal-lines',
          body: {
            journal_entry_id: foreignEntryId,
            line_number: 2,
            account_id: foreignAccountId,
            debit: 0,
            credit: 1,
          },
        },
        {
          method: 'PATCH',
          path: `/journal-lines/${foreignLineId}`,
          body: { debit: 5 },
        },
        { method: 'DELETE', path: `/journal-lines/${foreignLineId}` },
        {
          method: 'GET',
          path: `/recurring-journal-templates?company_id=${foreignCompanyId}`,
        },
        { method: 'GET', path: `/recurring-journal-templates/${foreignTemplateId}` },
        {
          method: 'POST',
          path: '/recurring-journal-templates/run-due',
          body: { company_id: foreignCompanyId },
        },
        {
          method: 'POST',
          path: '/recurring-journal-templates',
          body: {
            company_id: foreignCompanyId,
            template_name: 'x',
            narration_template: 'x',
            frequency: 'monthly',
            start_date: '2026-01-01',
            lines: [
              {
                line_number: 1,
                account_id: foreignAccountId,
                debit: 1,
                credit: 0,
              },
            ],
          },
        },
        {
          method: 'PATCH',
          path: `/recurring-journal-templates/${foreignTemplateId}`,
          body: { template_name: 'y' },
        },
        { method: 'DELETE', path: `/recurring-journal-templates/${foreignTemplateId}` },
        {
          method: 'POST',
          path: `/recurring-journal-templates/${foreignTemplateId}/lines`,
          body: {
            line_number: 2,
            account_id: foreignAccountId,
            debit: 0,
            credit: 1,
          },
        },
        {
          method: 'POST',
          path: `/recurring-journal-templates/${foreignTemplateId}/generate`,
          body: {},
        },
        {
          method: 'PATCH',
          path: `/recurring-journal-template-lines/${foreignTemplateLineId}`,
          body: { debit: 2 },
        },
        {
          method: 'DELETE',
          path: `/recurring-journal-template-lines/${foreignTemplateLineId}`,
        },
        { method: 'GET', path: `/audit-log?company_id=${foreignCompanyId}` },
        {
          method: 'GET',
          path: `/reports/trial-balance?company_id=${foreignCompanyId}&period_id=${foreignPeriodId}`,
        },
        {
          method: 'GET',
          path: `/reports/balance-sheet?company_id=${foreignCompanyId}&as_of_date=2026-01-31`,
        },
        {
          method: 'GET',
          path: `/reports/profit-and-loss?company_id=${foreignCompanyId}&period_start=2026-01-01&period_end=2026-01-31`,
        },
        {
          method: 'GET',
          path: `/reports/general-ledger?company_id=${foreignCompanyId}`,
        },
        {
          method: 'GET',
          path: `/reports/customer-ledger?company_id=${foreignCompanyId}&customer_id=${foreignCustomerId}`,
        },
        {
          method: 'GET',
          path: `/reports/customer-statement?company_id=${foreignCompanyId}&customer_id=${foreignCustomerId}`,
        },
        {
          method: 'GET',
          path: `/reports/aged-receivables?company_id=${foreignCompanyId}&as_of_date=2026-01-31`,
        },
        {
          method: 'GET',
          path: `/reports/credit-limit-check?company_id=${foreignCompanyId}&customer_id=${foreignCustomerId}`,
        },
        {
          method: 'GET',
          path: `/reports/customer-payment-history?company_id=${foreignCompanyId}&customer_id=${foreignCustomerId}`,
        },
        {
          method: 'GET',
          path: `/reports/supplier-ledger?company_id=${foreignCompanyId}&supplier_id=${foreignSupplierId}`,
        },
        {
          method: 'GET',
          path: `/reports/aged-payables?company_id=${foreignCompanyId}&as_of_date=2026-01-31`,
        },
        {
          method: 'GET',
          path: `/reports/bills-due?company_id=${foreignCompanyId}&as_of_date=2026-01-31`,
        },
        {
          method: 'POST',
          path: '/reports/reconcile-supplier-statement',
          body: {
            company_id: foreignCompanyId,
            supplier_id: foreignSupplierId,
            statement_date: '2026-01-31',
          },
        },
        { method: 'GET', path: `/customers?company_id=${foreignCompanyId}` },
        { method: 'GET', path: `/customers/${foreignCustomerId}` },
        {
          method: 'POST',
          path: '/customers',
          body: {
            company_id: foreignCompanyId,
            customer_name: 'Should fail',
          },
        },
        {
          method: 'PATCH',
          path: `/customers/${foreignCustomerId}`,
          body: { customer_name: 'Nope' },
        },
        { method: 'PATCH', path: `/customers/${foreignCustomerId}/deactivate` },
        { method: 'GET', path: `/invoices?company_id=${foreignCompanyId}` },
        { method: 'GET', path: `/invoices/${foreignInvoiceId}` },
        {
          method: 'POST',
          path: '/invoices',
          body: {
            company_id: foreignCompanyId,
            customer_id: foreignCustomerId,
            invoice_date: '2026-06-01',
            payment_terms: 'net_30',
          },
        },
        {
          method: 'PATCH',
          path: `/invoices/${foreignInvoiceId}`,
          body: { notes: 'Nope' },
        },
        { method: 'DELETE', path: `/invoices/${foreignInvoiceId}` },
        { method: 'POST', path: `/invoices/${foreignInvoiceId}/issue`, body: {} },
        {
          method: 'POST',
          path: `/invoices/${foreignInvoiceId}/void`,
          body: { void_reason: 'Nope' },
        },
        { method: 'POST', path: `/invoices/${foreignInvoiceId}/send` },
        { method: 'POST', path: `/invoices/${foreignInvoiceId}/mark-viewed` },
        { method: 'POST', path: `/invoices/${foreignInvoiceId}/write-off`, body: { reason: 'Auth probe' } },
        {
          method: 'PATCH',
          path: `/invoices/${foreignInvoiceId}/debtor-notified`,
          body: { debtor_notified_at: '2026-06-01' },
        },
        {
          method: 'POST',
          path: '/invoice-lines',
          body: {
            invoice_id: foreignInvoiceId,
            line_number: 2,
            description: 'Nope',
            quantity: 1,
            unit_price: 1,
            vat_rate: 5,
          },
        },
        {
          method: 'PATCH',
          path: `/invoice-lines/${foreignInvoiceLineId}`,
          body: { description: 'Nope' },
        },
        { method: 'DELETE', path: `/invoice-lines/${foreignInvoiceLineId}` },
        { method: 'GET', path: `/payments?company_id=${foreignCompanyId}` },
        { method: 'GET', path: `/payments/${foreignPaymentId}` },
        {
          method: 'POST',
          path: '/payments',
          body: {
            company_id: foreignCompanyId,
            customer_id: foreignCustomerId,
            payment_date: '2026-06-15',
            amount: 10,
            payment_method: 'cash',
          },
        },
        {
          method: 'PATCH',
          path: `/payments/${foreignPaymentId}`,
          body: { reference_number: 'Nope' },
        },
        { method: 'DELETE', path: `/payments/${foreignPaymentId}` },
        { method: 'POST', path: `/payments/${foreignPaymentId}/post` },
        {
          method: 'POST',
          path: '/payment-applications',
          body: {
            payment_id: foreignPaymentId,
            invoice_id: foreignInvoiceId,
            applied_amount: 1,
          },
        },
        { method: 'DELETE', path: `/payment-applications/${foreignPaymentApplicationId}` },
        { method: 'POST', path: `/payment-applications/${foreignPaymentApplicationId}/post` },
        { method: 'GET', path: `/public-holidays?company_id=${foreignCompanyId}` },
        {
          method: 'POST',
          path: '/public-holidays',
          body: {
            company_id: foreignCompanyId,
            holiday_date: '2099-07-01',
            description: 'Nope',
          },
        },
        {
          method: 'PATCH',
          path: `/public-holidays/${foreignPublicHolidayId}`,
          body: { holiday_date: '2099-07-02' },
        },
        { method: 'DELETE', path: `/public-holidays/${foreignPublicHolidayId}` },
        { method: 'GET', path: `/suppliers?company_id=${foreignCompanyId}` },
        { method: 'GET', path: `/suppliers/${foreignSupplierId}` },
        {
          method: 'POST',
          path: '/suppliers',
          body: { company_id: foreignCompanyId, supplier_name: 'Nope' },
        },
        { method: 'PATCH', path: `/suppliers/${foreignSupplierId}`, body: { supplier_name: 'Nope' } },
        { method: 'PATCH', path: `/suppliers/${foreignSupplierId}/deactivate` },
        { method: 'GET', path: `/purchase-orders?company_id=${foreignCompanyId}` },
        { method: 'GET', path: `/purchase-orders/${foreignPurchaseOrderId}` },
        {
          method: 'POST',
          path: '/purchase-orders',
          body: {
            company_id: foreignCompanyId,
            supplier_id: foreignSupplierId,
            po_date: '2026-06-01',
          },
        },
        { method: 'GET', path: `/goods-receipts?company_id=${foreignCompanyId}` },
        { method: 'GET', path: `/goods-receipts/${foreignGoodsReceiptId}` },
        { method: 'GET', path: `/bills?company_id=${foreignCompanyId}` },
        { method: 'GET', path: `/bills/${foreignBillId}` },
        {
          method: 'POST',
          path: '/bills',
          body: {
            company_id: foreignCompanyId,
            supplier_id: foreignSupplierId,
            bill_date: '2026-06-05',
          },
        },
        { method: 'POST', path: `/bills/${foreignBillId}/issue` },
        { method: 'GET', path: `/supplier-payments?company_id=${foreignCompanyId}` },
        { method: 'GET', path: `/supplier-payments/${foreignSupplierPaymentId}` },
        { method: 'GET', path: `/supplier-payment-runs?company_id=${foreignCompanyId}` },
        { method: 'GET', path: `/supplier-payment-runs/${foreignPaymentRunId}` },
        { method: 'GET', path: `/supplier-statement-lines?company_id=${foreignCompanyId}` },
        { method: 'GET', path: `/supplier-statement-lines/${foreignStatementLineId}` },
      ];

      const failures: string[] = [];
      for (const c of cases) {
        const result = await http(c.method, c.path, c.body);
        if (result.status !== 403) {
          failures.push(
            `${c.method} ${c.path} → ${result.status} (expected 403) body=${JSON.stringify(result.json)}`,
          );
        }
      }
      expect(failures).toEqual([]);
    });

    it('member still succeeds on the same route shapes for their company', async () => {
      const listAccounts = await http(
        'GET',
        `/accounts?company_id=${memberCompanyId}`,
      );
      expect(listAccounts.status).toBe(200);

      const getAccount = await http('GET', `/accounts/${memberAccountId}`);
      expect(getAccount.status).toBe(200);

      const trialBalance = await http(
        'GET',
        `/accounts/${memberAccountId}/trial-balance`,
      );
      expect(trialBalance.status).toBe(200);

      const listPeriods = await http(
        'GET',
        `/accounting-periods?company_id=${memberCompanyId}`,
      );
      expect(listPeriods.status).toBe(200);

      const listJe = await http(
        'GET',
        `/journal-entries?company_id=${memberCompanyId}`,
      );
      expect(listJe.status).toBe(200);

      const listTpl = await http(
        'GET',
        `/recurring-journal-templates?company_id=${memberCompanyId}`,
      );
      expect(listTpl.status).toBe(200);

      const audit = await http('GET', `/audit-log?company_id=${memberCompanyId}`);
      expect(audit.status).toBe(200);

      const { data: memberPeriod } = await supabase.client
        .from('accounting_periods')
        .select('id')
        .eq('company_id', memberCompanyId)
        .eq('period_start', '2026-01-01')
        .single();
      const periodTb = await http(
        'GET',
        `/reports/trial-balance?company_id=${memberCompanyId}&period_id=${memberPeriod!.id}`,
      );
      expect(periodTb.status).toBe(200);

      const balanceSheet = await http(
        'GET',
        `/reports/balance-sheet?company_id=${memberCompanyId}&as_of_date=2026-01-31`,
      );
      expect(balanceSheet.status).toBe(200);

      const pnl = await http(
        'GET',
        `/reports/profit-and-loss?company_id=${memberCompanyId}&period_start=2026-01-01&period_end=2026-01-31`,
      );
      expect(pnl.status).toBe(200);

      const gl = await http(
        'GET',
        `/reports/general-ledger?company_id=${memberCompanyId}`,
      );
      expect(gl.status).toBe(200);

      const runDue = await http('POST', '/recurring-journal-templates/run-due', {
        company_id: memberCompanyId,
      });
      expect(runDue.status).not.toBe(403);
      expect(runDue.status).not.toBe(401);
    });
  },
);
