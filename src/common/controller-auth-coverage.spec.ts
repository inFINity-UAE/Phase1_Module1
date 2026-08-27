import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { AccountsController } from '../accounts/accounts.controller';
import { AccountsService } from '../accounts/accounts.service';
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

/**
 * [feature-spec.md decisions #24/#27/#41] Controllers reject unauthenticated
 * requests (401) and succeed for a verified Bearer session with membership.
 */
describe('Controller auth coverage (decision #24)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let getUser: jest.Mock;
  let resolveRole: jest.Mock;
  let resolveCompanyIdForResource: jest.Mock;

  const sessionUserId = '00000000-0000-0000-0000-0000000000a2';
  const companyId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  beforeAll(async () => {
    getUser = jest.fn();
    resolveRole = jest.fn().mockResolvedValue(CompanyRole.Owner);
    resolveCompanyIdForResource = jest.fn().mockResolvedValue(companyId);

    const accountsService = {
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }),
      create: jest.fn().mockResolvedValue({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }),
      update: jest.fn().mockResolvedValue({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }),
      deactivate: jest.fn().mockResolvedValue({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    const accountingPeriodsService = {
      create: jest.fn().mockResolvedValue({ id: '22222222-2222-2222-2222-222222222222' }),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: '22222222-2222-2222-2222-222222222222' }),
      update: jest.fn().mockResolvedValue({ id: '22222222-2222-2222-2222-222222222222' }),
      softClose: jest.fn().mockResolvedValue({ id: '22222222-2222-2222-2222-222222222222' }),
    };

    const journalEntriesService = {
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({
        entry: { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', company_id: companyId },
        lines: [],
        attachments: [],
      }),
      getAttachments: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({
        entry: { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
        lines: [],
        attachments: [],
      }),
      create: jest.fn().mockResolvedValue({
        entry: { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
        lines: [],
        attachments: [],
      }),
      createOpeningBalance: jest.fn(),
      runYearEndClosing: jest.fn(),
      post: jest.fn(),
      approve: jest.fn(),
      reject: jest.fn(),
      reverse: jest.fn(),
      createLine: jest.fn().mockResolvedValue({
        id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        journal_entry_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        line_number: 1,
        account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        debit: 1,
        credit: 0,
      }),
      updateLine: jest.fn().mockResolvedValue({ id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }),
      deleteLine: jest.fn().mockResolvedValue(undefined),
    };

    const recurringService = {
      create: jest.fn().mockResolvedValue({ id: 'dddddddd-dddd-dddd-dddd-dddddddddddd' }),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: 'dddddddd-dddd-dddd-dddd-dddddddddddd' }),
      update: jest.fn().mockResolvedValue({ id: 'dddddddd-dddd-dddd-dddd-dddddddddddd' }),
      remove: jest.fn().mockResolvedValue(undefined),
      addLine: jest.fn().mockResolvedValue({ id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' }),
      generateTemplate: jest.fn().mockResolvedValue({
        template_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      }),
      runDueGenerations: jest.fn().mockResolvedValue([]),
      updateLine: jest.fn().mockResolvedValue({ id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' }),
      removeLine: jest.fn().mockResolvedValue(undefined),
    };

    const auditLogService = {
      find: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [
        AccountsController,
        AccountingPeriodsController,
        JournalEntriesController,
        JournalLinesController,
        RecurringJournalTemplatesController,
        RecurringJournalTemplateLinesController,
        AuditLogController,
      ],
      providers: [
        SupabaseAuthGuard,
        CompanyMembershipGuard,
        { provide: AccountsService, useValue: accountsService },
        { provide: AccountingPeriodsService, useValue: accountingPeriodsService },
        { provide: JournalEntriesService, useValue: journalEntriesService },
        { provide: RecurringJournalTemplatesService, useValue: recurringService },
        { provide: AuditLogService, useValue: auditLogService },
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

  const previouslyUnguardedRoutes: Array<{ method: string; path: string; body?: unknown }> = [
    { method: 'GET', path: `/accounts?company_id=${companyId}` },
    { method: 'GET', path: '/accounts/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    {
      method: 'POST',
      path: '/accounts',
      body: { company_id: companyId, account_number: '1999', account_name: 'X', category: 'asset', normal_balance: 'debit' },
    },
    { method: 'PATCH', path: '/accounts/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/deactivate' },
    {
      method: 'PATCH',
      path: '/accounts/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      body: { account_name: 'Renamed' },
    },
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
    {
      method: 'PATCH',
      path: '/accounting-periods/22222222-2222-2222-2222-222222222222',
      body: { fiscal_year: 2027 },
    },
    { method: 'GET', path: `/journal-entries?company_id=${companyId}` },
    { method: 'GET', path: '/journal-entries/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
    { method: 'GET', path: '/journal-entries/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/attachments' },
    {
      method: 'PATCH',
      path: '/journal-entries/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      body: { narration: 'revised' },
    },
    { method: 'GET', path: `/recurring-journal-templates?company_id=${companyId}` },
    { method: 'POST', path: '/recurring-journal-templates/run-due', body: { company_id: companyId } },
    { method: 'PATCH', path: '/recurring-journal-templates/dddddddd-dddd-dddd-dddd-dddddddddddd', body: {} },
    {
      method: 'DELETE',
      path: '/recurring-journal-templates/dddddddd-dddd-dddd-dddd-dddddddddddd',
    },
    {
      method: 'POST',
      path: '/recurring-journal-templates/dddddddd-dddd-dddd-dddd-dddddddddddd/generate',
      body: {},
    },
    {
      method: 'POST',
      path: '/recurring-journal-templates/dddddddd-dddd-dddd-dddd-dddddddddddd/lines',
      body: {
        line_number: 1,
        account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        debit: 1,
        credit: 0,
      },
    },
    {
      method: 'PATCH',
      path: '/recurring-journal-template-lines/eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      body: {},
    },
    {
      method: 'DELETE',
      path: '/recurring-journal-template-lines/eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    },
    { method: 'GET', path: `/audit-log?company_id=${companyId}` },
    {
      method: 'POST',
      path: '/journal-lines',
      body: {
        journal_entry_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        line_number: 1,
        account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        debit: 1,
        credit: 0,
      },
    },
    {
      method: 'PATCH',
      path: '/journal-lines/ffffffff-ffff-ffff-ffff-ffffffffffff',
      body: { debit: 1 },
    },
    {
      method: 'DELETE',
      path: '/journal-lines/ffffffff-ffff-ffff-ffff-ffffffffffff',
    },
  ];

  it.each(previouslyUnguardedRoutes)(
    'unauthenticated $method $path returns 401',
    async ({ method, path, body }) => {
      getUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
      const result = await request(method, path, { body });
      expect(result.status).toBe(401);
    },
  );

  it.each([
    { method: 'GET', path: `/accounts?company_id=${companyId}` },
    {
      method: 'PATCH',
      path: '/accounts/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      body: { account_name: 'Renamed' },
    },
    {
      method: 'GET',
      path: `/accounting-periods?company_id=${companyId}`,
    },
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
    {
      method: 'PATCH',
      path: '/accounting-periods/22222222-2222-2222-2222-222222222222',
      body: { fiscal_year: 2027 },
    },
    {
      method: 'GET',
      path: '/journal-entries/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/attachments',
    },
    {
      method: 'GET',
      path: `/journal-entries?company_id=${companyId}`,
    },
    {
      method: 'PATCH',
      path: '/journal-entries/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      body: { narration: 'revised' },
    },
    { method: 'GET', path: `/recurring-journal-templates?company_id=${companyId}` },
    {
      method: 'POST',
      path: '/recurring-journal-templates/run-due',
      body: { company_id: companyId },
    },
    { method: 'GET', path: `/audit-log?company_id=${companyId}` },
    {
      method: 'PATCH',
      path: '/journal-lines/ffffffff-ffff-ffff-ffff-ffffffffffff',
      body: { debit: 1 },
    },
    {
      method: 'POST',
      path: '/journal-lines',
      body: {
        journal_entry_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        line_number: 1,
        account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        debit: 1,
        credit: 0,
      },
    },
    {
      method: 'DELETE',
      path: '/journal-lines/ffffffff-ffff-ffff-ffff-ffffffffffff',
    },
  ] as const)(
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
