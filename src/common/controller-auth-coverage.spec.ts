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

/**
 * [feature-spec.md decisions #24/#27/#41; feature-spec-1.1.H1.md #1]
 * Controllers reject unauthenticated requests (401) and succeed for a
 * verified Bearer session with membership. Regression list covers all
 * 82 guarded HTTP routes across 15 controllers.
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
    { method: 'POST', path: `/invoices/${invoiceId}/write-off` },
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
      createLine: jest.fn().mockResolvedValue({ id: invoiceLineId }),
      updateLine: jest.fn().mockResolvedValue({ id: invoiceLineId }),
      deleteLine: jest.fn().mockResolvedValue(undefined),
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
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [
        AccountsController,
        CustomersController,
        QuotationsController,
        QuotationLinesController,
        InvoicesController,
        InvoiceLinesController,
        CreditNotesController,
        CreditNoteLinesController,
        AccountingPeriodsController,
        JournalEntriesController,
        JournalLinesController,
        RecurringJournalTemplatesController,
        RecurringJournalTemplateLinesController,
        AuditLogController,
        ReportsController,
      ],
      providers: [
        SupabaseAuthGuard,
        CompanyMembershipGuard,
        { provide: AccountsService, useValue: accountsService },
        { provide: CustomersService, useValue: customersService },
        { provide: QuotationsService, useValue: quotationsService },
        { provide: InvoicesService, useValue: invoicesService },
        { provide: CreditNotesService, useValue: creditNotesService },
        { provide: AccountingPeriodsService, useValue: accountingPeriodsService },
        { provide: JournalEntriesService, useValue: journalEntriesService },
        { provide: RecurringJournalTemplatesService, useValue: recurringService },
        { provide: AuditLogService, useValue: auditLogService },
        { provide: ReportsService, useValue: reportsService },
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
    expect(ALL_GUARDED_ROUTES).toHaveLength(83);
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
