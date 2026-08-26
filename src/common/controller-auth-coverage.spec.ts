import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { AccountsController } from '../accounts/accounts.controller';
import { AccountsService } from '../accounts/accounts.service';
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
import { JournalEntryCompanyRoleGuard } from '../auth/guards/journal-entry-company-role.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';

/**
 * [feature-spec.md decisions #24/#27] Controllers reject unauthenticated requests (401)
 * and still succeed for a verified Bearer session — same bar as #21.
 */
describe('Controller auth coverage (decision #24)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let getUser: jest.Mock;

  const sessionUserId = '00000000-0000-0000-0000-0000000000a2';

  beforeAll(async () => {
    getUser = jest.fn();

    const accountsService = {
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }),
      create: jest.fn().mockResolvedValue({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }),
      update: jest.fn().mockResolvedValue({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }),
      deactivate: jest.fn().mockResolvedValue({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    const journalEntriesService = {
      findAll: jest.fn().mockImplementation(() => {
        throw new Error('Not implemented.');
      }),
      findOne: jest.fn().mockResolvedValue({
        entry: { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', company_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc' },
        lines: [],
        attachments: [],
      }),
      getAttachments: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(() => {
        throw new Error('Not implemented.');
      }),
      create: jest.fn().mockResolvedValue({ entry: { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }, lines: [], attachments: [] }),
      createOpeningBalance: jest.fn(),
      runYearEndClosing: jest.fn(),
      post: jest.fn(),
      approve: jest.fn(),
      reject: jest.fn(),
      reverse: jest.fn(),
      createLine: jest.fn().mockImplementation(() => {
        throw new Error('Not implemented.');
      }),
      updateLine: jest.fn().mockResolvedValue({ id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }),
    };

    const recurringService = {
      create: jest.fn().mockResolvedValue({ id: 'dddddddd-dddd-dddd-dddd-dddddddddddd' }),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: 'dddddddd-dddd-dddd-dddd-dddddddddddd' }),
      update: jest.fn().mockResolvedValue({ id: 'dddddddd-dddd-dddd-dddd-dddddddddddd' }),
      remove: jest.fn().mockResolvedValue(undefined),
      addLine: jest.fn().mockResolvedValue({ id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' }),
      generateTemplate: jest.fn().mockResolvedValue({ template_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd' }),
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
        JournalEntriesController,
        JournalLinesController,
        RecurringJournalTemplatesController,
        RecurringJournalTemplateLinesController,
        AuditLogController,
      ],
      providers: [
        SupabaseAuthGuard,
        JournalEntryCompanyRoleGuard,
        { provide: AccountsService, useValue: accountsService },
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
            getMembership: jest.fn().mockResolvedValue({ role: 'owner' }),
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
    { method: 'GET', path: '/accounts' },
    { method: 'GET', path: '/accounts/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    { method: 'POST', path: '/accounts', body: {} },
    { method: 'PATCH', path: '/accounts/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/deactivate' },
    { method: 'GET', path: '/journal-entries' },
    { method: 'GET', path: '/journal-entries/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
    { method: 'GET', path: '/journal-entries/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/attachments' },
    { method: 'PATCH', path: '/journal-entries/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', body: {} },
    { method: 'GET', path: '/recurring-journal-templates' },
    { method: 'POST', path: '/recurring-journal-templates/run-due', body: {} },
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
      body: {},
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
    { method: 'GET', path: '/audit-log?company_id=cccccccc-cccc-cccc-cccc-cccccccccccc' },
    {
      method: 'POST',
      path: '/journal-lines',
      body: {
        journal_entry_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        line_number: 1,
        account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      },
    },
    {
      method: 'PATCH',
      path: '/journal-lines/ffffffff-ffff-ffff-ffff-ffffffffffff',
      body: { debit: 1 },
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
    { method: 'GET', path: '/accounts' },
    {
      method: 'GET',
      path: '/journal-entries/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/attachments',
    },
    { method: 'GET', path: '/recurring-journal-templates' },
    { method: 'POST', path: '/recurring-journal-templates/run-due', body: {} },
    { method: 'GET', path: '/audit-log?company_id=cccccccc-cccc-cccc-cccc-cccccccccccc' },
    {
      method: 'PATCH',
      path: '/journal-lines/ffffffff-ffff-ffff-ffff-ffffffffffff',
      body: { debit: 1 },
    },
  ] as const)(
    'authenticated $method $path reaches handler (not 401)',
    async ({ method, path, body }) => {
      getUser.mockResolvedValue({
        data: { user: { id: sessionUserId } },
        error: null,
      });

      const result = await request(method, path, { token: 'valid-session-token', body });
      expect(result.status).not.toBe(401);
      expect(result.status).not.toBe(403);
      expect(getUser).toHaveBeenCalledWith('valid-session-token');
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
