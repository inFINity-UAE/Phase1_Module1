import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PostgrestError } from '@supabase/supabase-js';
import { RecurrenceFrequency } from '../common/enums/recurrence-frequency.enum';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { PeriodStatus } from '../common/enums/period-status.enum';
import {
  JOURNAL_ENTRIES_REPOSITORY,
  JournalEntriesRepository,
} from '../journal-entries/journal-entries.repository';
import { JournalEntryWithDetails } from '../journal-entries/entities/journal-entry-with-details.entity';
import { formatUnbalancedPostError } from '../journal-entries/journal-entry-balance.util';
import { RecurringJournalTemplateWithLines } from './entities/recurring-journal-template-with-lines.entity';
import { advanceNextRunDate } from './recurring-run-date.util';
import {
  RECURRING_JOURNAL_TEMPLATES_REPOSITORY,
  RecurringJournalTemplatesRepository,
} from './recurring-journal-templates.repository';
import { RecurringJournalTemplatesService } from './recurring-journal-templates.service';

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const PERIOD_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const TEMPLATE_ID = '44444444-4444-4444-4444-444444444444';
const ACCOUNT_A = '55555555-5555-5555-5555-555555555555';
const ACCOUNT_B = '66666666-6666-6666-6666-666666666666';
const ENTRY_ID = '77777777-7777-7777-7777-777777777777';
const RUN_DATE = '2026-01-31';

function pgError(code: string, message: string): PostgrestError {
  return { code, message, details: '', hint: '', name: 'PostgrestError' } as PostgrestError;
}

function templateWithLines(autoPost: boolean): RecurringJournalTemplateWithLines {
  return {
    template: {
      id: TEMPLATE_ID,
      company_id: COMPANY_ID,
      template_name: 'Monthly rent accrual',
      narration_template: 'Rent accrual for period',
      frequency: RecurrenceFrequency.Monthly,
      start_date: '2026-01-01',
      end_date: null,
      next_run_date: RUN_DATE,
      day_of_month: 31,
      auto_post: autoPost,
      is_active: true,
      created_by: USER_ID,
      created_at: '2026-08-22T00:00:00.000Z',
      updated_at: '2026-08-22T00:00:00.000Z',
    },
    lines: [
      {
        id: '88888888-8888-8888-8888-888888888888',
        template_id: TEMPLATE_ID,
        line_number: 1,
        account_id: ACCOUNT_A,
        debit: 1000,
        credit: 0,
        description: null,
      },
      {
        id: '99999999-9999-9999-9999-999999999999',
        template_id: TEMPLATE_ID,
        line_number: 2,
        account_id: ACCOUNT_B,
        debit: 0,
        credit: 1000,
        description: null,
      },
    ],
  };
}

function generatedEntry(status: JournalEntryStatus): JournalEntryWithDetails {
  return {
    entry: {
      id: ENTRY_ID,
      company_id: COMPANY_ID,
      entry_number: 42,
      period_id: PERIOD_ID,
      entry_date: RUN_DATE,
      entry_type: JournalEntryType.Recurring,
      status,
      narration: 'Rent accrual for period',
      reference_number: null,
      reverses_entry_id: null,
      reversed_by_entry_id: null,
      recurring_template_id: TEMPLATE_ID,
      requires_approval: false,
      approved_by: null,
      approved_at: null,
      rejected_by: null,
      rejected_at: null,
      rejection_reason: null,
      created_by: USER_ID,
      posted_at: status === JournalEntryStatus.Posted ? '2026-01-31T12:00:00.000Z' : null,
      created_at: '2026-08-22T00:00:00.000Z',
      updated_at: '2026-08-22T00:00:00.000Z',
    },
    lines: [
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        journal_entry_id: ENTRY_ID,
        line_number: 1,
        account_id: ACCOUNT_A,
        debit: 1000,
        credit: 0,
        description: null,
        cost_center: null,
        created_at: '2026-08-22T00:00:00.000Z',
      },
      {
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        journal_entry_id: ENTRY_ID,
        line_number: 2,
        account_id: ACCOUNT_B,
        debit: 0,
        credit: 1000,
        description: null,
        cost_center: null,
        created_at: '2026-08-22T00:00:00.000Z',
      },
    ],
    attachments: [],
  };
}

describe('RecurringJournalTemplatesService', () => {
  let service: RecurringJournalTemplatesService;
  let templatesRepository: jest.Mocked<RecurringJournalTemplatesRepository>;
  let journalRepository: jest.Mocked<JournalEntriesRepository>;

  const openPeriod = {
    id: PERIOD_ID,
    company_id: COMPANY_ID,
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    fiscal_year: 2026,
    status: PeriodStatus.Open,
    soft_closed_by: null,
    soft_closed_at: null,
    closed_by: null,
    closed_at: null,
    reopened_by: null,
    reopened_at: null,
    reopen_reason: null,
    created_at: '2026-08-22T00:00:00.000Z',
  };

  beforeEach(async () => {
    templatesRepository = {
      insert: jest.fn(),
      findAll: jest.fn(),
      findByIdWithLines: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      insertLine: jest.fn(),
      updateLine: jest.fn(),
      deleteLine: jest.fn(),
      findDueTemplates: jest.fn(),
      findOpenPeriodForDate: jest.fn(),
      updateSchedule: jest.fn(),
    };

    journalRepository = {
      getNextEntryNumber: jest.fn(),
      insertDraft: jest.fn(),
      findByIdWithDetails: jest.fn(),
      findAttachmentsByEntryId: jest.fn(),
      findPeriodById: jest.fn(),
      findEarliestOpenPeriod: jest.fn(),
      hasOpeningBalanceForFiscalYear: jest.fn(),
      insertOpeningBalanceDraft: jest.fn(),
      deleteEntry: jest.fn(),
      getAccountTrialBalance: jest.fn(),
      findNextOpenPeriod: jest.fn(),
      postEntry: jest.fn(),
      reverseEntry: jest.fn(),
      updateLine: jest.fn(),
      deleteLine: jest.fn(),
      getTrialBalanceTotals: jest.fn(),
      insertGeneratedFromTemplate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringJournalTemplatesService,
        { provide: RECURRING_JOURNAL_TEMPLATES_REPOSITORY, useValue: templatesRepository },
        { provide: JOURNAL_ENTRIES_REPOSITORY, useValue: journalRepository },
      ],
    }).compile();

    service = module.get(RecurringJournalTemplatesService);
  });

  it('a monthly template with auto_post=false generates a draft entry on its run date and does NOT post it', async () => {
    const template = templateWithLines(false);
    const draft = generatedEntry(JournalEntryStatus.Draft);
    const nextRunDate = advanceNextRunDate(
      RUN_DATE,
      RecurrenceFrequency.Monthly,
      template.template.day_of_month,
    );

    templatesRepository.findByIdWithLines.mockResolvedValue(template);
    templatesRepository.findOpenPeriodForDate.mockResolvedValue(openPeriod);
    journalRepository.insertGeneratedFromTemplate.mockResolvedValue(draft);
    templatesRepository.updateSchedule.mockResolvedValue({
      ...template.template,
      next_run_date: nextRunDate,
    });

    const result = await service.generateTemplate(TEMPLATE_ID, RUN_DATE);

    expect(journalRepository.insertGeneratedFromTemplate).toHaveBeenCalled();
    expect(journalRepository.postEntry).not.toHaveBeenCalled();
    expect(result.posted).toBe(false);
    expect(result.journal_entry?.entry.status).toBe(JournalEntryStatus.Draft);
    expect(result.journal_entry?.entry.recurring_template_id).toBe(TEMPLATE_ID);
  });

  it('a monthly template with auto_post=true generates and posts an entry automatically', async () => {
    const template = templateWithLines(true);
    const draft = generatedEntry(JournalEntryStatus.Draft);
    const posted = generatedEntry(JournalEntryStatus.Posted);
    const nextRunDate = advanceNextRunDate(
      RUN_DATE,
      RecurrenceFrequency.Monthly,
      template.template.day_of_month,
    );

    templatesRepository.findByIdWithLines.mockResolvedValue(template);
    templatesRepository.findOpenPeriodForDate.mockResolvedValue(openPeriod);
    journalRepository.insertGeneratedFromTemplate.mockResolvedValue(draft);
    journalRepository.postEntry.mockResolvedValue(posted.entry);
    journalRepository.findByIdWithDetails.mockResolvedValue(posted);
    templatesRepository.updateSchedule.mockResolvedValue({
      ...template.template,
      next_run_date: nextRunDate,
    });

    const result = await service.generateTemplate(TEMPLATE_ID, RUN_DATE);

    expect(journalRepository.postEntry).toHaveBeenCalledWith(ENTRY_ID);
    expect(result.posted).toBe(true);
    expect(result.journal_entry?.entry.status).toBe(JournalEntryStatus.Posted);
    expect(result.journal_entry?.entry.posted_at).toBeTruthy();
  });

  it('next_run_date advances correctly after generation', async () => {
    expect(advanceNextRunDate('2026-01-31', RecurrenceFrequency.Monthly, 31)).toBe('2026-02-28');

    const template = templateWithLines(false);
    const draft = generatedEntry(JournalEntryStatus.Draft);

    templatesRepository.findByIdWithLines.mockResolvedValue(template);
    templatesRepository.findOpenPeriodForDate.mockResolvedValue(openPeriod);
    journalRepository.insertGeneratedFromTemplate.mockResolvedValue(draft);
    templatesRepository.updateSchedule.mockResolvedValue({
      ...template.template,
      next_run_date: '2026-02-28',
    });

    const result = await service.generateTemplate(TEMPLATE_ID, RUN_DATE);

    expect(templatesRepository.updateSchedule).toHaveBeenCalledWith(
      TEMPLATE_ID,
      '2026-02-28',
      true,
    );
    expect(result.next_run_date).toBe('2026-02-28');
  });

  it('a template generating an unbalanced entry is caught and does not silently post', async () => {
    const template = templateWithLines(true);
    template.lines[1].credit = 500;
    const draft = generatedEntry(JournalEntryStatus.Draft);
    draft.lines[1].credit = 500;

    templatesRepository.findByIdWithLines.mockResolvedValue(template);
    templatesRepository.findOpenPeriodForDate.mockResolvedValue(openPeriod);
    journalRepository.insertGeneratedFromTemplate.mockResolvedValue(draft);
    journalRepository.postEntry.mockRejectedValue(
      pgError(
        'P0001',
        'Journal entry 42 is unbalanced: debit 1000.00 <> credit 500.00 — posting rejected',
      ),
    );
    journalRepository.deleteEntry.mockResolvedValue(undefined);

    const expectedMessage = formatUnbalancedPostError(
      draft.entry.entry_number,
      draft.lines,
    );

    const result = await service.generateTemplate(TEMPLATE_ID, RUN_DATE);

    expect(journalRepository.deleteEntry).toHaveBeenCalledWith(ENTRY_ID);
    expect(templatesRepository.updateSchedule).not.toHaveBeenCalled();
    expect(result.posted).toBe(false);
    expect(result.journal_entry).toBeNull();
    expect(result.error).toBe(expectedMessage);
    expect(result.next_run_date).toBe(RUN_DATE);
  });
});

describe('RecurringJournalTemplatesService create validation', () => {
  let service: RecurringJournalTemplatesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringJournalTemplatesService,
        {
          provide: RECURRING_JOURNAL_TEMPLATES_REPOSITORY,
          useValue: { insert: jest.fn() },
        },
        {
          provide: JOURNAL_ENTRIES_REPOSITORY,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get(RecurringJournalTemplatesService);
  });

  it('rejects template creation with zero lines', async () => {
    await expect(
      service.create({
        company_id: COMPANY_ID,
        template_name: 'Empty',
        narration_template: 'N/A',
        frequency: RecurrenceFrequency.Monthly,
        start_date: '2026-01-01',
        created_by: USER_ID,
        lines: [],
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
