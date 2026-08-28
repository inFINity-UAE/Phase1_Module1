import { BadRequestException } from '@nestjs/common';
import { RecurrenceFrequency } from '../common/enums/recurrence-frequency.enum';
import { SupabaseRecurringJournalTemplatesRepository } from './recurring-journal-templates.repository.supabase';

/**
 * [feature-spec.md §7.16 finding #4 / decision #44] Recurring template line
 * account_id uses the same assertAccountsUsableForCompany helper as journal paths.
 */
describe('Recurring template line account_id validation (decision #44)', () => {
  const COMPANY_ID = '00000000-0000-0000-0000-000000000002';
  const OTHER_COMPANY = '00000000-0000-0000-0000-000000000099';
  const ACCOUNT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const ACCOUNT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const TEMPLATE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const LINE_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  const USER_ID = '00000000-0000-0000-0000-0000000000a2';

  function buildRepo(
    accountRows: Array<{
      id: string;
      company_id: string;
      is_active: boolean;
      account_number: string;
    }>,
  ) {
    const client = {
      from: (table: string) => {
        if (table === 'accounts') {
          return {
            select: () => ({
              in: async (_col: string, ids: string[]) => ({
                data: accountRows.filter((row) => ids.includes(row.id)),
                error: null,
              }),
            }),
          };
        }
        if (table === 'recurring_journal_templates') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { company_id: COMPANY_ID },
                  error: null,
                }),
              }),
            }),
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: {
                    id: TEMPLATE_ID,
                    company_id: COMPANY_ID,
                    template_name: 't',
                    narration_template: 'n',
                    frequency: RecurrenceFrequency.Monthly,
                    start_date: '2026-01-01',
                    end_date: null,
                    next_run_date: '2026-01-01',
                    day_of_month: null,
                    auto_post: false,
                    is_active: true,
                    created_by: USER_ID,
                  },
                  error: null,
                }),
              }),
            }),
            delete: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        }
        if (table === 'recurring_journal_template_lines') {
          return {
            insert: (rows: unknown) => {
              if (Array.isArray(rows)) {
                return {
                  select: async () => ({
                    data: (rows as object[]).map((row, i) => ({
                      id: `line-${i}`,
                      ...row,
                    })),
                    error: null,
                  }),
                };
              }
              return {
                select: () => ({
                  single: async () => ({
                    data: { id: LINE_ID, ...(rows as object) },
                    error: null,
                  }),
                }),
              };
            },
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    template_id: TEMPLATE_ID,
                    recurring_journal_templates: { company_id: COMPANY_ID },
                  },
                  error: null,
                }),
              }),
            }),
            update: () => ({
              eq: () => ({
                select: () => ({
                  single: async () => ({
                    data: { id: LINE_ID, account_id: ACCOUNT_A },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };

    return new SupabaseRecurringJournalTemplatesRepository({
      client,
    } as never);
  }

  const baseCreate = {
    company_id: COMPANY_ID,
    template_name: 'Rent',
    narration_template: 'Rent',
    frequency: RecurrenceFrequency.Monthly,
    start_date: '2026-01-01',
    created_by: USER_ID,
    lines: [
      { line_number: 1, account_id: ACCOUNT_A, debit: 10, credit: 0 },
      { line_number: 2, account_id: ACCOUNT_B, debit: 0, credit: 10 },
    ],
  };

  it('rejects template create with cross-company account_id (400 shape)', async () => {
    const repo = buildRepo([
      {
        id: ACCOUNT_A,
        company_id: OTHER_COMPANY,
        is_active: true,
        account_number: '1010',
      },
      {
        id: ACCOUNT_B,
        company_id: COMPANY_ID,
        is_active: true,
        account_number: '1020',
      },
    ]);

    await expect(repo.insert(baseCreate)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(repo.insert(baseCreate)).rejects.toThrow(/different company/i);
  });

  it('rejects template create with inactive account_id (400 shape)', async () => {
    const repo = buildRepo([
      {
        id: ACCOUNT_A,
        company_id: COMPANY_ID,
        is_active: false,
        account_number: '1010',
      },
      {
        id: ACCOUNT_B,
        company_id: COMPANY_ID,
        is_active: true,
        account_number: '1020',
      },
    ]);

    await expect(repo.insert(baseCreate)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(repo.insert(baseCreate)).rejects.toThrow(/inactive/i);
  });

  it('accepts template create with same-company active accounts', async () => {
    const repo = buildRepo([
      {
        id: ACCOUNT_A,
        company_id: COMPANY_ID,
        is_active: true,
        account_number: '1010',
      },
      {
        id: ACCOUNT_B,
        company_id: COMPANY_ID,
        is_active: true,
        account_number: '1020',
      },
    ]);

    const result = await repo.insert(baseCreate);
    expect(result.template.company_id).toBe(COMPANY_ID);
    expect(result.lines).toHaveLength(2);
  });

  it('rejects insertLine with cross-company account_id', async () => {
    const repo = buildRepo([
      {
        id: ACCOUNT_A,
        company_id: OTHER_COMPANY,
        is_active: true,
        account_number: '1010',
      },
    ]);

    await expect(
      repo.insertLine(TEMPLATE_ID, {
        line_number: 3,
        account_id: ACCOUNT_A,
        debit: 1,
        credit: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      repo.insertLine(TEMPLATE_ID, {
        line_number: 3,
        account_id: ACCOUNT_A,
        debit: 1,
        credit: 0,
      }),
    ).rejects.toThrow(/different company/i);
  });

  it('rejects updateLine account_id change to inactive account', async () => {
    const repo = buildRepo([
      {
        id: ACCOUNT_A,
        company_id: COMPANY_ID,
        is_active: false,
        account_number: '1010',
      },
    ]);

    await expect(
      repo.updateLine(LINE_ID, { account_id: ACCOUNT_A }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      repo.updateLine(LINE_ID, { account_id: ACCOUNT_A }),
    ).rejects.toThrow(/inactive/i);
  });

  it('accepts insertLine with same-company active account', async () => {
    const repo = buildRepo([
      {
        id: ACCOUNT_A,
        company_id: COMPANY_ID,
        is_active: true,
        account_number: '1010',
      },
    ]);

    const line = await repo.insertLine(TEMPLATE_ID, {
      line_number: 3,
      account_id: ACCOUNT_A,
      debit: 1,
      credit: 0,
    });
    expect(line.account_id).toBe(ACCOUNT_A);
  });

  it('accepts updateLine account_id change to same-company active account', async () => {
    const repo = buildRepo([
      {
        id: ACCOUNT_A,
        company_id: COMPANY_ID,
        is_active: true,
        account_number: '1010',
      },
    ]);

    const line = await repo.updateLine(LINE_ID, { account_id: ACCOUNT_A });
    expect(line.id).toBe(LINE_ID);
  });
});
