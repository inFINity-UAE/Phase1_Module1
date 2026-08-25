import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import { CreateOpeningBalanceDto } from '../journal-entries/dto/create-opening-balance.dto';
import { CreateYearEndClosingDto } from '../journal-entries/dto/create-year-end-closing.dto';
import { UpdateJournalEntryDto } from '../journal-entries/dto/update-journal-entry.dto';
import {
  ApproveJournalEntryDto,
  PostJournalEntryDto,
  RejectJournalEntryDto,
} from '../journal-entries/dto/journal-entry-approval.dto';
import { SoftCloseAccountingPeriodDto } from '../accounting-periods/dto/soft-close-accounting-period.dto';
import { CreateAccountingPeriodDto } from '../accounting-periods/dto/create-accounting-period.dto';
import { CreateRecurringJournalTemplateDto } from '../recurring-journal-templates/dto/create-recurring-journal-template.dto';
import { UpdateRecurringJournalTemplateDto } from '../recurring-journal-templates/dto/update-recurring-journal-template.dto';
import { RunRecurringGenerationDto } from '../recurring-journal-templates/dto/run-recurring-generation.dto';
import { CreateAccountDto } from '../accounts/dto/create-account.dto';
import { UpdateAccountDto } from '../accounts/dto/update-account.dto';
import { QueryAuditLogDto } from '../audit-log/dto/query-audit-log.dto';
import { AccountCategory } from './enums/account-category.enum';
import { NormalBalance } from './enums/normal-balance.enum';
import { RecurrenceFrequency } from './enums/recurrence-frequency.enum';

/**
 * [feature-spec.md decisions #10/#11/#21/#24] Global ValidationPipe whitelist must reject
 * client-supplied identity/role fields on mutation DTOs — not silently strip them.
 */
describe('DTO identity whitelist (forbidNonWhitelisted)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const meta = (metatype: unknown): ArgumentMetadata => ({
    type: 'body',
    metatype: metatype as ArgumentMetadata['metatype'],
    data: '',
  });

  async function expectForbiddenProperty(
    dtoClass: new () => unknown,
    validBody: Record<string, unknown>,
    spoofField: string,
  ): Promise<void> {
    await expect(
      pipe.transform({ ...validBody, [spoofField]: '00000000-0000-0000-0000-00000000dead' }, meta(dtoClass)),
    ).rejects.toBeInstanceOf(BadRequestException);
  }

  const companyId = '00000000-0000-0000-0000-000000000002';
  const periodId = '11111111-1111-1111-1111-111111111111';
  const accountA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const accountB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const sessionFilterActor = '00000000-0000-0000-0000-000000000003';

  const validCreateJournal: Record<string, unknown> = {
    company_id: companyId,
    period_id: periodId,
    entry_date: '2026-01-15',
    narration: 'valid',
    lines: [
      { line_number: 1, account_id: accountA, debit: 10, credit: 0 },
      { line_number: 2, account_id: accountB, debit: 0, credit: 10 },
    ],
  };

  const validOpeningBalance: Record<string, unknown> = {
    company_id: companyId,
    fiscal_year: 2026,
    entry_date: '2026-01-01',
    narration: 'opening',
    lines: [
      { line_number: 1, account_id: accountA, debit: 100, credit: 0 },
      { line_number: 2, account_id: accountB, debit: 0, credit: 100 },
    ],
  };

  const validYearEnd: Record<string, unknown> = {
    company_id: companyId,
    fiscal_year: 2026,
  };

  const validPeriodCreate: Record<string, unknown> = {
    company_id: companyId,
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    fiscal_year: 2026,
  };

  const validRecurring: Record<string, unknown> = {
    company_id: companyId,
    template_name: 'Depreciation',
    narration_template: 'Monthly dep',
    frequency: RecurrenceFrequency.Monthly,
    start_date: '2026-02-01',
    lines: [
      { line_number: 1, account_id: accountA, debit: 1, credit: 0 },
      { line_number: 2, account_id: accountB, debit: 0, credit: 1 },
    ],
  };

  const validAccount: Record<string, unknown> = {
    company_id: companyId,
    account_number: '1999',
    account_name: 'Test',
    category: AccountCategory.Asset,
    normal_balance: NormalBalance.Debit,
  };

  it.each([
    ['created_by', CreateJournalEntryDto, validCreateJournal],
    ['actor_id', CreateJournalEntryDto, validCreateJournal],
    ['actor_role', CreateJournalEntryDto, validCreateJournal],
    ['approved_by', CreateJournalEntryDto, validCreateJournal],
    ['rejected_by', CreateJournalEntryDto, validCreateJournal],
    ['created_by', UpdateJournalEntryDto, { narration: 'adj' }],
    ['actor_role', UpdateJournalEntryDto, { narration: 'adj' }],
    ['created_by', CreateOpeningBalanceDto, validOpeningBalance],
    ['actor_id', CreateOpeningBalanceDto, validOpeningBalance],
    ['created_by', CreateYearEndClosingDto, validYearEnd],
    ['actor_role', CreateYearEndClosingDto, validYearEnd],
    ['closed_by', SoftCloseAccountingPeriodDto, {}],
    ['actor_id', SoftCloseAccountingPeriodDto, {}],
    ['closed_by', CreateAccountingPeriodDto, validPeriodCreate],
    ['soft_closed_by', CreateAccountingPeriodDto, validPeriodCreate],
    ['reopened_by', CreateAccountingPeriodDto, validPeriodCreate],
    ['created_by', CreateRecurringJournalTemplateDto, validRecurring],
    ['actor_id', CreateRecurringJournalTemplateDto, validRecurring],
    ['created_by', UpdateRecurringJournalTemplateDto, { template_name: 'x' }],
    ['actor_id', UpdateRecurringJournalTemplateDto, { template_name: 'x' }],
    ['created_by', RunRecurringGenerationDto, {}],
    ['actor_id', RunRecurringGenerationDto, {}],
    ['actor_id', CreateAccountDto, validAccount],
    ['created_by', CreateAccountDto, validAccount],
    ['actor_role', UpdateAccountDto, { account_name: 'Renamed' }],
    ['approved_by', PostJournalEntryDto, {}],
    ['actor_role', ApproveJournalEntryDto, {}],
    ['rejected_by', RejectJournalEntryDto, { rejection_reason: 'incomplete docs' }],
  ] as const)(
    'rejects spoofed %s on %s',
    async (field, dtoClass, validBody) => {
      await expectForbiddenProperty(dtoClass, { ...validBody }, field);
    },
  );

  it('accepts create journal entry without identity fields', async () => {
    const result = await pipe.transform(validCreateJournal, meta(CreateJournalEntryDto));
    expect(result).toMatchObject({
      company_id: companyId,
      narration: 'valid',
    });
    expect(result).not.toHaveProperty('created_by');
  });

  it('accepts opening-balance without created_by', async () => {
    const result = await pipe.transform(validOpeningBalance, meta(CreateOpeningBalanceDto));
    expect(result).toMatchObject({ fiscal_year: 2026 });
    expect(result).not.toHaveProperty('created_by');
  });

  it('accepts year-end-close without created_by', async () => {
    const result = await pipe.transform(validYearEnd, meta(CreateYearEndClosingDto));
    expect(result).toMatchObject({ fiscal_year: 2026 });
    expect(result).not.toHaveProperty('created_by');
  });

  it('accepts empty soft-close body', async () => {
    const result = await pipe.transform({}, meta(SoftCloseAccountingPeriodDto));
    expect(result).toEqual({});
    expect(result).not.toHaveProperty('closed_by');
  });

  it('audit query actor_id remains a filter (not acting identity)', async () => {
    const result = await pipe.transform(
      { company_id: companyId, actor_id: sessionFilterActor },
      { type: 'query', metatype: QueryAuditLogDto, data: '' },
    );
    expect(result).toMatchObject({
      company_id: companyId,
      actor_id: sessionFilterActor,
    });
  });
});
