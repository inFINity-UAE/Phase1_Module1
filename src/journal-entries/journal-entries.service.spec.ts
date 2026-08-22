import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PostgrestError } from '@supabase/supabase-js';
import { CompanyRole } from '../common/enums/company-role.enum';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { PeriodStatus } from '../common/enums/period-status.enum';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';
import { CreateYearEndClosingDto } from './dto/create-year-end-closing.dto';
import { AccountCategory } from '../common/enums/account-category.enum';
import { NormalBalance } from '../common/enums/normal-balance.enum';
import { JournalEntryWithDetails } from './entities/journal-entry-with-details.entity';
import { formatUnbalancedPostError } from './journal-entry-balance.util';
import {
  JOURNAL_ENTRIES_REPOSITORY,
  JournalEntriesRepository,
} from './journal-entries.repository';
import {
  ACCOUNTING_PERIODS_REPOSITORY,
  AccountingPeriodsRepository,
} from '../accounting-periods/accounting-periods.repository';
import { AccountingPeriod } from '../accounting-periods/entities/accounting-period.entity';
import { JournalEntriesService } from './journal-entries.service';

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const PERIOD_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const ACCOUNT_A = '44444444-4444-4444-4444-444444444444';
const ACCOUNT_B = '55555555-5555-5555-5555-555555555555';
const ENTRY_ID = '66666666-6666-6666-6666-666666666666';
const LINE_ID = '77777777-7777-7777-7777-777777777777';
const NEXT_PERIOD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const REVERSAL_ENTRY_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const RETAINED_EARNINGS_ID = '3e393fe1-29e4-46b3-b447-f0939b8683da';
const INCOME_ACCOUNT_ID = 'f7dc3374-7da4-4c62-b05e-2bbd3ced77b2';
const EXPENSE_ACCOUNT_ID = 'ca13540e-90c1-4184-bef6-fdc0a79b02c7';
const FISCAL_YEAR = 2026;
const OWNER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const ownerActor = { actor_id: OWNER_ID, actor_role: CompanyRole.Owner };
const accountantActor = { actor_id: USER_ID, actor_role: CompanyRole.Accountant };

function pgError(code: string, message: string): PostgrestError {
  return { code, message, details: '', hint: '', name: 'PostgrestError' } as PostgrestError;
}

function draftDetails(
  overrides: Partial<JournalEntryWithDetails> = {},
): JournalEntryWithDetails {
  return {
    entry: {
      id: ENTRY_ID,
      company_id: COMPANY_ID,
      entry_number: 1,
      period_id: PERIOD_ID,
      entry_date: '2026-01-15',
      entry_type: JournalEntryType.Manual,
      status: JournalEntryStatus.Draft,
      narration: 'Test narration',
      reference_number: 'REF-001',
      reverses_entry_id: null,
      reversed_by_entry_id: null,
      recurring_template_id: null,
      requires_approval: false,
      approved_by: null,
      approved_at: null,
      rejected_by: null,
      rejected_at: null,
      rejection_reason: null,
      created_by: USER_ID,
      posted_at: null,
      created_at: '2026-08-22T00:00:00.000Z',
      updated_at: '2026-08-22T00:00:00.000Z',
    },
    lines: [
      {
        id: LINE_ID,
        journal_entry_id: ENTRY_ID,
        line_number: 1,
        account_id: ACCOUNT_A,
        debit: 100,
        credit: 0,
        description: null,
        cost_center: null,
        created_at: '2026-08-22T00:00:00.000Z',
      },
      {
        id: '88888888-8888-8888-8888-888888888888',
        journal_entry_id: ENTRY_ID,
        line_number: 2,
        account_id: ACCOUNT_B,
        debit: 0,
        credit: 100,
        description: null,
        cost_center: null,
        created_at: '2026-08-22T00:00:00.000Z',
      },
    ],
    attachments: [],
    ...overrides,
  };
}

function samplePeriod(status: PeriodStatus = PeriodStatus.Open): AccountingPeriod {
  return {
    id: PERIOD_ID,
    company_id: COMPANY_ID,
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    fiscal_year: FISCAL_YEAR,
    status,
    soft_closed_by: status === PeriodStatus.SoftClosed ? USER_ID : null,
    soft_closed_at: status === PeriodStatus.SoftClosed ? '2026-08-22T00:00:00.000Z' : null,
    closed_by: null,
    closed_at: null,
    reopened_by: null,
    reopened_at: null,
    reopen_reason: null,
    created_at: '2026-08-22T00:00:00.000Z',
  };
}

function postedDetails(
  overrides: Partial<JournalEntryWithDetails> = {},
): JournalEntryWithDetails {
  return draftDetails({
    entry: {
      ...draftDetails().entry,
      status: JournalEntryStatus.Posted,
      posted_at: '2026-01-15T12:00:00.000Z',
    },
    ...overrides,
  });
}

describe('JournalEntriesService', () => {
  let service: JournalEntriesService;
  let repository: jest.Mocked<JournalEntriesRepository>;
  let periodsRepository: jest.Mocked<AccountingPeriodsRepository>;

  const companySettingsOpen = {
    company_id: COMPANY_ID,
    journal_approval_threshold: null,
    approval_threshold_currency: 'AED',
    default_period_length: 'monthly',
    allow_period_reopen: true,
    updated_at: '2026-08-22T00:00:00.000Z',
  };

  const baseDto: CreateJournalEntryDto = {
    company_id: COMPANY_ID,
    period_id: PERIOD_ID,
    entry_date: '2026-01-15',
    narration: 'Test narration',
    reference_number: 'REF-001',
    created_by: USER_ID,
    lines: [
      { line_number: 1, account_id: ACCOUNT_A, debit: 100, credit: 0 },
      { line_number: 2, account_id: ACCOUNT_B, debit: 0, credit: 100 },
    ],
  };

  beforeEach(async () => {
    repository = {
      getNextEntryNumber: jest.fn(),
      insertDraft: jest.fn(),
      findByIdWithDetails: jest.fn(),
      findAttachmentsByEntryId: jest.fn(),
      findPeriodById: jest.fn(),
      findNextOpenPeriod: jest.fn(),
      findEarliestOpenPeriod: jest.fn(),
      hasOpeningBalanceForFiscalYear: jest.fn(),
      hasYearEndClosingForFiscalYear: jest.fn(),
      findLatestPeriodForFiscalYear: jest.fn(),
      findRetainedEarningsAccount: jest.fn(),
      getProfitAndLossBalancesForFiscalYear: jest.fn(),
      insertOpeningBalanceDraft: jest.fn(),
      insertYearEndClosingDraft: jest.fn(),
      deleteEntry: jest.fn(),
      getAccountTrialBalance: jest.fn(),
      getCompanySettings: jest.fn(),
      submitForApproval: jest.fn(),
      approveAndPostEntry: jest.fn(),
      rejectEntry: jest.fn(),
      insertGeneratedFromTemplate: jest.fn(),
      postEntry: jest.fn(),
      reverseEntry: jest.fn(),
      updateLine: jest.fn(),
      deleteLine: jest.fn(),
      getTrialBalanceTotals: jest.fn(),
    };

    periodsRepository = {
      findById: jest.fn(),
      softClose: jest.fn(),
      logSoftClosedPostingOverride: jest.fn(),
    };
    periodsRepository.findById.mockResolvedValue(samplePeriod());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JournalEntriesService,
        { provide: JOURNAL_ENTRIES_REPOSITORY, useValue: repository },
        { provide: ACCOUNTING_PERIODS_REPOSITORY, useValue: periodsRepository },
      ],
    }).compile();

    service = module.get(JournalEntriesService);
  });

  it('creating a draft entry with balanced lines succeeds', async () => {
    const created = draftDetails();
    repository.insertDraft.mockResolvedValue(created);

    await expect(service.create(baseDto)).resolves.toEqual(created);
    expect(created.entry.status).toBe(JournalEntryStatus.Draft);
    expect(created.lines.reduce((s, l) => s + l.debit, 0)).toBe(
      created.lines.reduce((s, l) => s + l.credit, 0),
    );
  });

  it('creating a draft entry with UNBALANCED lines still succeeds', async () => {
    const unbalancedDto: CreateJournalEntryDto = {
      ...baseDto,
      lines: [
        { line_number: 1, account_id: ACCOUNT_A, debit: 100, credit: 0 },
        { line_number: 2, account_id: ACCOUNT_B, debit: 0, credit: 50 },
      ],
    };
    const created = draftDetails({
      lines: [
        {
          id: LINE_ID,
          journal_entry_id: ENTRY_ID,
          line_number: 1,
          account_id: ACCOUNT_A,
          debit: 100,
          credit: 0,
          description: null,
          cost_center: null,
          created_at: '2026-08-22T00:00:00.000Z',
        },
        {
          id: '88888888-8888-8888-8888-888888888888',
          journal_entry_id: ENTRY_ID,
          line_number: 2,
          account_id: ACCOUNT_B,
          debit: 0,
          credit: 50,
          description: null,
          cost_center: null,
          created_at: '2026-08-22T00:00:00.000Z',
        },
      ],
    });
    repository.insertDraft.mockResolvedValue(created);

    const result = await service.create(unbalancedDto);
    expect(result.entry.status).toBe(JournalEntryStatus.Draft);
    expect(result.lines[0].debit).toBe(100);
    expect(result.lines[1].credit).toBe(50);
  });

  it('creating an entry with zero lines fails', async () => {
    await expect(service.create({ ...baseDto, lines: [] })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.create({ ...baseDto, lines: [] })).rejects.toThrow(
      'Journal entry must have at least one line',
    );
    expect(repository.insertDraft).not.toHaveBeenCalled();
  });

  it('attaching a file to an entry works and is retrievable', async () => {
    const attachment = {
      id: '99999999-9999-9999-9999-999999999999',
      journal_entry_id: ENTRY_ID,
      file_name: 'invoice.pdf',
      file_url: 'https://example.com/invoice.pdf',
      file_size_bytes: 12345,
      uploaded_by: USER_ID,
      uploaded_at: '2026-08-22T00:00:00.000Z',
    };
    const created = draftDetails({ attachments: [attachment] });
    repository.insertDraft.mockResolvedValue(created);
    repository.findByIdWithDetails.mockResolvedValue(created);
    repository.findAttachmentsByEntryId.mockResolvedValue([attachment]);

    const dto: CreateJournalEntryDto = {
      ...baseDto,
      attachments: [
        {
          file_name: 'invoice.pdf',
          file_url: 'https://example.com/invoice.pdf',
          file_size_bytes: 12345,
        },
      ],
    };

    const result = await service.create(dto);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].file_name).toBe('invoice.pdf');

    const fetched = await service.getAttachments(ENTRY_ID);
    expect(fetched).toEqual([attachment]);
    expect(repository.findAttachmentsByEntryId).toHaveBeenCalledWith(ENTRY_ID);
  });

  it('getAttachments throws NotFoundException when entry missing', async () => {
    repository.findByIdWithDetails.mockResolvedValue(null);

    await expect(service.getAttachments(ENTRY_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('posting a balanced draft succeeds and posted_at is set', async () => {
    const draft = draftDetails();
    const postedAt = '2026-08-22T12:00:00.000Z';
    const posted = draftDetails({
      entry: {
        ...draft.entry,
        status: JournalEntryStatus.Posted,
        posted_at: postedAt,
      },
    });

    repository.findByIdWithDetails
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(posted);
    repository.postEntry.mockResolvedValue(posted.entry);

    const result = await service.post(ENTRY_ID, ownerActor);

    expect(repository.postEntry).toHaveBeenCalledWith(ENTRY_ID);
    expect(result.entry.status).toBe(JournalEntryStatus.Posted);
    expect(result.entry.posted_at).toBe(postedAt);
  });

  it('posting an unbalanced draft fails with a specific, readable error message', async () => {
    const unbalanced = draftDetails({
      lines: [
        {
          id: LINE_ID,
          journal_entry_id: ENTRY_ID,
          line_number: 1,
          account_id: ACCOUNT_A,
          debit: 100,
          credit: 0,
          description: null,
          cost_center: null,
          created_at: '2026-08-22T00:00:00.000Z',
        },
        {
          id: '88888888-8888-8888-8888-888888888888',
          journal_entry_id: ENTRY_ID,
          line_number: 2,
          account_id: ACCOUNT_B,
          debit: 0,
          credit: 50,
          description: null,
          cost_center: null,
          created_at: '2026-08-22T00:00:00.000Z',
        },
      ],
    });

    repository.findByIdWithDetails.mockResolvedValue(unbalanced);
    repository.postEntry.mockRejectedValue(
      pgError(
        'P0001',
        'Journal entry 1 is unbalanced: debit 100.00 <> credit 50.00 — posting rejected',
      ),
    );

    const expectedMessage = formatUnbalancedPostError(
      unbalanced.entry.entry_number,
      unbalanced.lines,
    );

    await expect(service.post(ENTRY_ID, ownerActor)).rejects.toThrow(BadRequestException);
    await expect(service.post(ENTRY_ID, ownerActor)).rejects.toThrow(expectedMessage);
  });

  it('after posting, attempting to edit a line fails with a DB trigger error', async () => {
    repository.updateLine.mockRejectedValue(
      pgError(
        'P0001',
        'Cannot modify lines of a posted journal entry — reverse it instead',
      ),
    );

    await expect(service.updateLine(LINE_ID, { debit: 999 })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.updateLine(LINE_ID, { debit: 999 })).rejects.toThrow(
      'Cannot modify lines of a posted journal entry',
    );
  });

  it('after posting, attempting to delete a line fails with a DB trigger error', async () => {
    repository.deleteLine.mockRejectedValue(
      pgError(
        'P0001',
        'Cannot modify lines of a posted journal entry — reverse it instead',
      ),
    );

    await expect(service.deleteLine(LINE_ID)).rejects.toThrow(BadRequestException);
    await expect(service.deleteLine(LINE_ID)).rejects.toThrow(
      'Cannot modify lines of a posted journal entry',
    );
  });

  it('[Rules §3.1] trial balance totals stay equal after posting balanced entries', async () => {
    repository.getTrialBalanceTotals
      .mockResolvedValueOnce({ total_debit: 1000, total_credit: 1000 })
      .mockResolvedValueOnce({ total_debit: 1600, total_credit: 1600 });

    const before = await repository.getTrialBalanceTotals(COMPANY_ID);
    const after = await repository.getTrialBalanceTotals(COMPANY_ID);

    expect(before.total_debit).toBe(before.total_credit);
    expect(after.total_debit).toBe(after.total_credit);
    expect(after.total_debit - before.total_debit).toBe(600);
    expect(after.total_credit - before.total_credit).toBe(600);
  });

  it('reversing a posted entry creates a correctly mirrored entry and sets the original status to reversed', async () => {
    const original = postedDetails();
    const reversal = postedDetails({
      entry: {
        ...original.entry,
        id: REVERSAL_ENTRY_ID,
        entry_number: 2,
        period_id: NEXT_PERIOD_ID,
        entry_date: '2026-02-01',
        entry_type: JournalEntryType.Reversal,
        status: JournalEntryStatus.Posted,
        narration: 'Reversal of journal entry 1',
        reverses_entry_id: ENTRY_ID,
        reversed_by_entry_id: null,
        posted_at: '2026-02-01T12:00:00.000Z',
      },
      lines: [
        {
          id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          journal_entry_id: REVERSAL_ENTRY_ID,
          line_number: 1,
          account_id: ACCOUNT_A,
          debit: 0,
          credit: 100,
          description: null,
          cost_center: null,
          created_at: '2026-08-22T00:00:00.000Z',
        },
        {
          id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
          journal_entry_id: REVERSAL_ENTRY_ID,
          line_number: 2,
          account_id: ACCOUNT_B,
          debit: 100,
          credit: 0,
          description: null,
          cost_center: null,
          created_at: '2026-08-22T00:00:00.000Z',
        },
      ],
    });
    const reversedOriginal = postedDetails({
      entry: {
        ...original.entry,
        status: JournalEntryStatus.Reversed,
        reversed_by_entry_id: REVERSAL_ENTRY_ID,
      },
    });

    repository.findByIdWithDetails.mockResolvedValue(original);
    repository.findPeriodById.mockResolvedValue({
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
    });
    repository.findNextOpenPeriod.mockResolvedValue({
      id: NEXT_PERIOD_ID,
      company_id: COMPANY_ID,
      period_start: '2026-02-01',
      period_end: '2026-02-28',
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
    });
    repository.reverseEntry.mockResolvedValue({
      original: reversedOriginal,
      reversal,
    });

    const result = await service.reverse(ENTRY_ID, { created_by: USER_ID });

    expect(repository.reverseEntry).toHaveBeenCalledWith(ENTRY_ID, USER_ID);
    expect(result.original.entry.status).toBe(JournalEntryStatus.Reversed);
    expect(result.original.entry.reversed_by_entry_id).toBe(REVERSAL_ENTRY_ID);
    expect(result.reversal.entry.entry_type).toBe(JournalEntryType.Reversal);
    expect(result.reversal.entry.reverses_entry_id).toBe(ENTRY_ID);
    expect(result.reversal.entry.period_id).toBe(NEXT_PERIOD_ID);
    expect(result.reversal.lines[0].debit).toBe(original.lines[0].credit);
    expect(result.reversal.lines[0].credit).toBe(original.lines[0].debit);
    expect(result.reversal.lines[1].debit).toBe(original.lines[1].credit);
    expect(result.reversal.lines[1].credit).toBe(original.lines[1].debit);
  });

  it('the original entry remains queryable with reversed_by_entry_id set', async () => {
    const reversedOriginal = postedDetails({
      entry: {
        ...postedDetails().entry,
        status: JournalEntryStatus.Reversed,
        reversed_by_entry_id: REVERSAL_ENTRY_ID,
      },
    });

    repository.findByIdWithDetails.mockResolvedValue(reversedOriginal);

    const fetched = await service.findOne(ENTRY_ID);

    expect(fetched.entry.status).toBe(JournalEntryStatus.Reversed);
    expect(fetched.entry.reversed_by_entry_id).toBe(REVERSAL_ENTRY_ID);
    expect(fetched.lines).toHaveLength(2);
  });

  it('attempting to reverse an entry that is already status = reversed fails cleanly, with no new entry created', async () => {
    const alreadyReversed = postedDetails({
      entry: {
        ...postedDetails().entry,
        status: JournalEntryStatus.Reversed,
        reversed_by_entry_id: REVERSAL_ENTRY_ID,
      },
    });

    repository.findByIdWithDetails.mockResolvedValue(alreadyReversed);

    await expect(service.reverse(ENTRY_ID, { created_by: USER_ID })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.reverse(ENTRY_ID, { created_by: USER_ID })).rejects.toThrow(
      'Journal entry 1 has already been reversed and cannot be reversed again',
    );
    expect(repository.reverseEntry).not.toHaveBeenCalled();
  });

  it('fails when no open period exists after the original entry period', async () => {
    const original = postedDetails();
    repository.findByIdWithDetails.mockResolvedValue(original);
    repository.findPeriodById.mockResolvedValue({
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
    });
    repository.findNextOpenPeriod.mockResolvedValue(null);

    await expect(service.reverse(ENTRY_ID, { created_by: USER_ID })).rejects.toThrow(
      /No open accounting period exists after 2026-01-31/,
    );
    expect(repository.reverseEntry).not.toHaveBeenCalled();
  });

  describe('period soft-close posting', () => {
    it('posting into an open period succeeds', async () => {
      const draft = draftDetails();
      const posted = draftDetails({
        entry: {
          ...draft.entry,
          status: JournalEntryStatus.Posted,
          posted_at: '2026-08-22T12:00:00.000Z',
        },
      });

      periodsRepository.findById.mockResolvedValue(samplePeriod(PeriodStatus.Open));
      repository.findByIdWithDetails
        .mockResolvedValueOnce(draft)
        .mockResolvedValueOnce(posted);
      repository.getCompanySettings.mockResolvedValue(companySettingsOpen);
      repository.postEntry.mockResolvedValue(posted.entry);

      const result = await service.post(ENTRY_ID, ownerActor);

      expect(result.entry.status).toBe(JournalEntryStatus.Posted);
      expect(periodsRepository.logSoftClosedPostingOverride).not.toHaveBeenCalled();
    });

    it('posting into a soft-closed period fails without override', async () => {
      const draft = draftDetails();

      periodsRepository.findById.mockResolvedValue(samplePeriod(PeriodStatus.SoftClosed));
      repository.findByIdWithDetails.mockResolvedValue(draft);

      await expect(service.post(ENTRY_ID, ownerActor)).rejects.toThrow(BadRequestException);
      await expect(service.post(ENTRY_ID, ownerActor)).rejects.toThrow(
        /provide soft_closed_override_reason/,
      );
      expect(repository.postEntry).not.toHaveBeenCalled();
    });

    it('posting into a soft-closed period succeeds WITH override, and the override is recorded with a reason', async () => {
      const draft = draftDetails();
      const posted = draftDetails({
        entry: {
          ...draft.entry,
          status: JournalEntryStatus.Posted,
          posted_at: '2026-08-22T12:00:00.000Z',
        },
      });
      const softClosed = samplePeriod(PeriodStatus.SoftClosed);
      const loggedPeriod = {
        ...softClosed,
        reopened_by: OWNER_ID,
        reopened_at: '2026-08-22T12:00:00.000Z',
        reopen_reason: 'Correcting missed accrual',
      };

      periodsRepository.findById.mockResolvedValue(softClosed);
      repository.findByIdWithDetails
        .mockResolvedValueOnce(draft)
        .mockResolvedValueOnce(posted);
      repository.getCompanySettings.mockResolvedValue(companySettingsOpen);
      repository.postEntry.mockResolvedValue(posted.entry);
      periodsRepository.logSoftClosedPostingOverride.mockResolvedValue(loggedPeriod);

      const result = await service.post(ENTRY_ID, {
        ...ownerActor,
        soft_closed_override_reason: 'Correcting missed accrual',
      });

      expect(periodsRepository.logSoftClosedPostingOverride).toHaveBeenCalledWith(
        PERIOD_ID,
        OWNER_ID,
        'Correcting missed accrual',
      );
      expect(repository.postEntry).toHaveBeenCalledWith(ENTRY_ID);
      expect(result.entry.status).toBe(JournalEntryStatus.Posted);
    });

    it('a non-authorized user cannot use the override', async () => {
      const draft = draftDetails();

      periodsRepository.findById.mockResolvedValue(samplePeriod(PeriodStatus.SoftClosed));
      repository.findByIdWithDetails.mockResolvedValue(draft);
      repository.getCompanySettings.mockResolvedValue(companySettingsOpen);

      await expect(
        service.post(ENTRY_ID, {
          ...accountantActor,
          soft_closed_override_reason: 'Should not be allowed',
        }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.post(ENTRY_ID, {
          ...accountantActor,
          soft_closed_override_reason: 'Should not be allowed',
        }),
      ).rejects.toThrow(/Only an Owner may post into a soft-closed period/);
      expect(periodsRepository.logSoftClosedPostingOverride).not.toHaveBeenCalled();
      expect(repository.postEntry).not.toHaveBeenCalled();
    });
  });

  describe('approval workflow', () => {
    const companySettings = (threshold: number | null) => ({
      company_id: COMPANY_ID,
      journal_approval_threshold: threshold,
      approval_threshold_currency: 'AED',
      default_period_length: 'monthly',
      allow_period_reopen: true,
      updated_at: '2026-08-22T00:00:00.000Z',
    });

    it('an entry below threshold posts directly without needing approval', async () => {
      const draft = draftDetails();
      const posted = draftDetails({
        entry: {
          ...draft.entry,
          status: JournalEntryStatus.Posted,
          posted_at: '2026-08-22T12:00:00.000Z',
        },
      });

      repository.findByIdWithDetails
        .mockResolvedValueOnce(draft)
        .mockResolvedValueOnce(posted);
      repository.getCompanySettings.mockResolvedValue(companySettings(5000));
      repository.postEntry.mockResolvedValue(posted.entry);

      const result = await service.post(ENTRY_ID, accountantActor);

      expect(repository.submitForApproval).not.toHaveBeenCalled();
      expect(repository.postEntry).toHaveBeenCalledWith(ENTRY_ID);
      expect(result.entry.status).toBe(JournalEntryStatus.Posted);
    });

    it('an entry at/above threshold goes to pending_approval, not posted', async () => {
      const draft = draftDetails();
      const pending = draftDetails({
        entry: {
          ...draft.entry,
          status: JournalEntryStatus.PendingApproval,
          requires_approval: true,
        },
      });

      repository.findByIdWithDetails
        .mockResolvedValueOnce(draft)
        .mockResolvedValueOnce(pending);
      repository.getCompanySettings.mockResolvedValue(companySettings(100));
      repository.submitForApproval.mockResolvedValue(pending.entry);

      const result = await service.post(ENTRY_ID, accountantActor);

      expect(repository.submitForApproval).toHaveBeenCalledWith(ENTRY_ID);
      expect(repository.postEntry).not.toHaveBeenCalled();
      expect(result.entry.status).toBe(JournalEntryStatus.PendingApproval);
      expect(result.entry.posted_at).toBeNull();
    });

    it('a non-Owner attempting to approve is rejected', async () => {
      const pending = draftDetails({
        entry: {
          ...draftDetails().entry,
          status: JournalEntryStatus.PendingApproval,
          requires_approval: true,
        },
      });

      repository.findByIdWithDetails.mockResolvedValue(pending);

      await expect(
        service.approve(ENTRY_ID, accountantActor),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.approve(ENTRY_ID, accountantActor),
      ).rejects.toThrow(/Only an Owner can approve/);
      expect(repository.approveAndPostEntry).not.toHaveBeenCalled();
    });

    it('approval of a pending entry posts it and applies balance validation', async () => {
      const pending = draftDetails({
        entry: {
          ...draftDetails().entry,
          status: JournalEntryStatus.PendingApproval,
          requires_approval: true,
        },
      });
      const posted = draftDetails({
        entry: {
          ...pending.entry,
          status: JournalEntryStatus.Posted,
          posted_at: '2026-08-22T12:00:00.000Z',
          approved_by: OWNER_ID,
          approved_at: '2026-08-22T12:00:00.000Z',
        },
      });

      repository.findByIdWithDetails
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(posted);
      repository.approveAndPostEntry.mockResolvedValue(posted.entry);

      const result = await service.approve(ENTRY_ID, ownerActor);

      expect(repository.approveAndPostEntry).toHaveBeenCalledWith(ENTRY_ID, OWNER_ID);
      expect(result.entry.status).toBe(JournalEntryStatus.Posted);
      expect(result.entry.approved_by).toBe(OWNER_ID);
    });

    it('approval of an unbalanced pending entry fails balance validation', async () => {
      const pending = draftDetails({
        entry: {
          ...draftDetails().entry,
          status: JournalEntryStatus.PendingApproval,
          requires_approval: true,
        },
        lines: [
          {
            id: LINE_ID,
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
            id: '88888888-8888-8888-8888-888888888888',
            journal_entry_id: ENTRY_ID,
            line_number: 2,
            account_id: ACCOUNT_B,
            debit: 0,
            credit: 500,
            description: null,
            cost_center: null,
            created_at: '2026-08-22T00:00:00.000Z',
          },
        ],
      });

      repository.findByIdWithDetails.mockResolvedValue(pending);
      repository.approveAndPostEntry.mockRejectedValue(
        pgError(
          'P0001',
          'Journal entry 1 is unbalanced: debit 1000.00 <> credit 500.00 — posting rejected',
        ),
      );

      const expectedMessage = formatUnbalancedPostError(
        pending.entry.entry_number,
        pending.lines,
      );

      await expect(service.approve(ENTRY_ID, ownerActor)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.approve(ENTRY_ID, ownerActor)).rejects.toThrow(
        expectedMessage,
      );
    });

    it('rejection leaves the entry unposted with a reason recorded', async () => {
      const pending = draftDetails({
        entry: {
          ...draftDetails().entry,
          status: JournalEntryStatus.PendingApproval,
          requires_approval: true,
        },
      });
      const rejected = draftDetails({
        entry: {
          ...pending.entry,
          status: JournalEntryStatus.Rejected,
          rejected_by: OWNER_ID,
          rejected_at: '2026-08-22T12:00:00.000Z',
          rejection_reason: 'Incorrect accrual amount',
        },
      });

      repository.findByIdWithDetails
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(rejected);
      repository.rejectEntry.mockResolvedValue(rejected.entry);

      const result = await service.reject(ENTRY_ID, {
        ...ownerActor,
        rejection_reason: 'Incorrect accrual amount',
      });

      expect(repository.rejectEntry).toHaveBeenCalledWith(
        ENTRY_ID,
        OWNER_ID,
        'Incorrect accrual amount',
      );
      expect(repository.approveAndPostEntry).not.toHaveBeenCalled();
      expect(result.entry.status).toBe(JournalEntryStatus.Rejected);
      expect(result.entry.posted_at).toBeNull();
      expect(result.entry.rejection_reason).toBe('Incorrect accrual amount');
    });

    it('Owner bypasses threshold and posts directly regardless of amount', async () => {
      const draft = draftDetails({
        lines: [
          {
            id: LINE_ID,
            journal_entry_id: ENTRY_ID,
            line_number: 1,
            account_id: ACCOUNT_A,
            debit: 10000,
            credit: 0,
            description: null,
            cost_center: null,
            created_at: '2026-08-22T00:00:00.000Z',
          },
          {
            id: '88888888-8888-8888-8888-888888888888',
            journal_entry_id: ENTRY_ID,
            line_number: 2,
            account_id: ACCOUNT_B,
            debit: 0,
            credit: 10000,
            description: null,
            cost_center: null,
            created_at: '2026-08-22T00:00:00.000Z',
          },
        ],
      });
      const posted = draftDetails({
        entry: {
          ...draft.entry,
          status: JournalEntryStatus.Posted,
          posted_at: '2026-08-22T12:00:00.000Z',
        },
        lines: draft.lines,
      });

      repository.findByIdWithDetails
        .mockResolvedValueOnce(draft)
        .mockResolvedValueOnce(posted);
      repository.postEntry.mockResolvedValue(posted.entry);

      const result = await service.post(ENTRY_ID, ownerActor);

      expect(repository.getCompanySettings).not.toHaveBeenCalled();
      expect(repository.submitForApproval).not.toHaveBeenCalled();
      expect(repository.postEntry).toHaveBeenCalledWith(ENTRY_ID);
      expect(result.entry.status).toBe(JournalEntryStatus.Posted);
    });
  });

  describe('opening balance', () => {
    const openingBalanceDto: CreateOpeningBalanceDto = {
      company_id: COMPANY_ID,
      fiscal_year: FISCAL_YEAR,
      entry_date: '2026-01-01',
      narration: 'Opening balances FY2026',
      created_by: USER_ID,
      lines: [
        { line_number: 1, account_id: ACCOUNT_A, debit: 500, credit: 0 },
        { line_number: 2, account_id: ACCOUNT_B, debit: 0, credit: 500 },
      ],
    };

    const earliestOpenPeriod = {
      id: PERIOD_ID,
      company_id: COMPANY_ID,
      period_start: '2026-01-01',
      period_end: '2026-01-31',
      fiscal_year: FISCAL_YEAR,
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

    it('a balanced opening balance entry posts successfully and account balances reflect it correctly', async () => {
      const draft = draftDetails({
        entry: {
          ...draftDetails().entry,
          entry_type: JournalEntryType.OpeningBalance,
          period_id: PERIOD_ID,
          entry_date: '2026-01-01',
          narration: 'Opening balances FY2026',
        },
        lines: [
          {
            id: LINE_ID,
            journal_entry_id: ENTRY_ID,
            line_number: 1,
            account_id: ACCOUNT_A,
            debit: 500,
            credit: 0,
            description: null,
            cost_center: null,
            created_at: '2026-08-22T00:00:00.000Z',
          },
          {
            id: '88888888-8888-8888-8888-888888888888',
            journal_entry_id: ENTRY_ID,
            line_number: 2,
            account_id: ACCOUNT_B,
            debit: 0,
            credit: 500,
            description: null,
            cost_center: null,
            created_at: '2026-08-22T00:00:00.000Z',
          },
        ],
      });
      const posted = postedDetails({
        entry: {
          ...draft.entry,
          entry_type: JournalEntryType.OpeningBalance,
          status: JournalEntryStatus.Posted,
          posted_at: '2026-01-01T12:00:00.000Z',
        },
        lines: draft.lines,
      });

      repository.hasOpeningBalanceForFiscalYear.mockResolvedValue(false);
      repository.findEarliestOpenPeriod.mockResolvedValue(earliestOpenPeriod);
      repository.insertOpeningBalanceDraft.mockResolvedValue(draft);
      repository.postEntry.mockResolvedValue(posted.entry);
      repository.findByIdWithDetails.mockResolvedValue(posted);
      repository.getAccountTrialBalance
        .mockResolvedValueOnce({
          account_id: ACCOUNT_A,
          total_debit: 500,
          total_credit: 0,
          balance: 500,
        })
        .mockResolvedValueOnce({
          account_id: ACCOUNT_B,
          total_debit: 0,
          total_credit: 500,
          balance: -500,
        });

      const result = await service.createOpeningBalance(openingBalanceDto);

      expect(repository.hasOpeningBalanceForFiscalYear).toHaveBeenCalledWith(
        COMPANY_ID,
        FISCAL_YEAR,
      );
      expect(repository.findEarliestOpenPeriod).toHaveBeenCalledWith(
        COMPANY_ID,
        FISCAL_YEAR,
      );
      expect(repository.insertOpeningBalanceDraft).toHaveBeenCalledWith(
        openingBalanceDto,
        PERIOD_ID,
      );
      expect(repository.postEntry).toHaveBeenCalledWith(ENTRY_ID);
      expect(result.entry.entry_type).toBe(JournalEntryType.OpeningBalance);
      expect(result.entry.status).toBe(JournalEntryStatus.Posted);
      expect(result.entry.period_id).toBe(PERIOD_ID);

      const balanceA = await service.getAccountTrialBalance(COMPANY_ID, ACCOUNT_A);
      const balanceB = await service.getAccountTrialBalance(COMPANY_ID, ACCOUNT_B);
      expect(balanceA?.total_debit).toBe(500);
      expect(balanceB?.total_credit).toBe(500);
    });

    it('an unbalanced opening balance entry is rejected the same way any other entry would be', async () => {
      const unbalancedDto: CreateOpeningBalanceDto = {
        ...openingBalanceDto,
        lines: [
          { line_number: 1, account_id: ACCOUNT_A, debit: 500, credit: 0 },
          { line_number: 2, account_id: ACCOUNT_B, debit: 0, credit: 300 },
        ],
      };
      const draft = draftDetails({
        entry: {
          ...draftDetails().entry,
          entry_type: JournalEntryType.OpeningBalance,
        },
        lines: [
          {
            id: LINE_ID,
            journal_entry_id: ENTRY_ID,
            line_number: 1,
            account_id: ACCOUNT_A,
            debit: 500,
            credit: 0,
            description: null,
            cost_center: null,
            created_at: '2026-08-22T00:00:00.000Z',
          },
          {
            id: '88888888-8888-8888-8888-888888888888',
            journal_entry_id: ENTRY_ID,
            line_number: 2,
            account_id: ACCOUNT_B,
            debit: 0,
            credit: 300,
            description: null,
            cost_center: null,
            created_at: '2026-08-22T00:00:00.000Z',
          },
        ],
      });

      repository.hasOpeningBalanceForFiscalYear.mockResolvedValue(false);
      repository.findEarliestOpenPeriod.mockResolvedValue(earliestOpenPeriod);
      repository.insertOpeningBalanceDraft.mockResolvedValue(draft);
      repository.postEntry.mockRejectedValue(
        pgError(
          'P0001',
          'Journal entry 1 is unbalanced: debit 500.00 <> credit 300.00 — posting rejected',
        ),
      );
      repository.deleteEntry.mockResolvedValue(undefined);

      const expectedMessage = formatUnbalancedPostError(
        draft.entry.entry_number,
        draft.lines,
      );

      await expect(service.createOpeningBalance(unbalancedDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createOpeningBalance(unbalancedDto)).rejects.toThrow(
        expectedMessage,
      );
      expect(repository.deleteEntry).toHaveBeenCalledWith(ENTRY_ID);
    });

    it('attempting to post a second opening_balance entry for the same company and fiscal year is rejected cleanly, with no new entry created', async () => {
      repository.hasOpeningBalanceForFiscalYear.mockResolvedValue(true);

      await expect(service.createOpeningBalance(openingBalanceDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createOpeningBalance(openingBalanceDto)).rejects.toThrow(
        `An opening balance entry already exists for fiscal year ${FISCAL_YEAR}`,
      );
      expect(repository.insertOpeningBalanceDraft).not.toHaveBeenCalled();
      expect(repository.postEntry).not.toHaveBeenCalled();
    });
  });

  describe('year-end closing', () => {
    const yearEndDto: CreateYearEndClosingDto = {
      company_id: COMPANY_ID,
      fiscal_year: FISCAL_YEAR,
      created_by: USER_ID,
    };

    const latestPeriod = {
      id: PERIOD_ID,
      company_id: COMPANY_ID,
      period_start: '2026-02-01',
      period_end: '2026-02-28',
      fiscal_year: FISCAL_YEAR,
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

    const plBalances = [
      {
        account_id: INCOME_ACCOUNT_ID,
        category: AccountCategory.Income,
        normal_balance: NormalBalance.Credit,
        total_debit: 0,
        total_credit: 1000,
        balance: 1000,
      },
      {
        account_id: EXPENSE_ACCOUNT_ID,
        category: AccountCategory.Expense,
        normal_balance: NormalBalance.Debit,
        total_debit: 600,
        total_credit: 0,
        balance: 600,
      },
    ];

    it('posts a balanced year-end closing entry that zeroes P&L into Retained Earnings', async () => {
      const draft = draftDetails({
        entry: {
          ...draftDetails().entry,
          entry_type: JournalEntryType.YearEndClosing,
          entry_date: '2026-02-28',
          narration: `Year-end closing for fiscal year ${FISCAL_YEAR}`,
        },
        lines: [
          {
            id: LINE_ID,
            journal_entry_id: ENTRY_ID,
            line_number: 1,
            account_id: INCOME_ACCOUNT_ID,
            debit: 1000,
            credit: 0,
            description: 'Year-end close — zero income balance',
            cost_center: null,
            created_at: '2026-08-22T00:00:00.000Z',
          },
          {
            id: '88888888-8888-8888-8888-888888888888',
            journal_entry_id: ENTRY_ID,
            line_number: 2,
            account_id: EXPENSE_ACCOUNT_ID,
            debit: 0,
            credit: 600,
            description: 'Year-end close — zero expense balance',
            cost_center: null,
            created_at: '2026-08-22T00:00:00.000Z',
          },
          {
            id: '99999999-9999-9999-9999-999999999999',
            journal_entry_id: ENTRY_ID,
            line_number: 3,
            account_id: RETAINED_EARNINGS_ID,
            debit: 0,
            credit: 400,
            description: 'Year-end close — net P&L to Retained Earnings',
            cost_center: null,
            created_at: '2026-08-22T00:00:00.000Z',
          },
        ],
      });
      const posted = draftDetails({
        entry: {
          ...draft.entry,
          status: JournalEntryStatus.Posted,
          posted_at: '2026-08-22T12:00:00.000Z',
        },
        lines: draft.lines,
      });

      repository.hasYearEndClosingForFiscalYear.mockResolvedValue(false);
      repository.findLatestPeriodForFiscalYear.mockResolvedValue(latestPeriod);
      repository.findRetainedEarningsAccount.mockResolvedValue({
        id: RETAINED_EARNINGS_ID,
      });
      repository.getProfitAndLossBalancesForFiscalYear.mockResolvedValue(plBalances);
      repository.insertYearEndClosingDraft.mockResolvedValue(draft);
      repository.postEntry.mockResolvedValue(posted.entry);
      repository.findByIdWithDetails.mockResolvedValue(posted);

      const result = await service.runYearEndClosing(yearEndDto);

      expect(repository.hasYearEndClosingForFiscalYear).toHaveBeenCalledWith(
        COMPANY_ID,
        FISCAL_YEAR,
      );
      expect(repository.insertYearEndClosingDraft).toHaveBeenCalledWith(
        yearEndDto,
        PERIOD_ID,
        '2026-02-28',
        expect.arrayContaining([
          expect.objectContaining({
            account_id: INCOME_ACCOUNT_ID,
            debit: 1000,
            credit: 0,
          }),
          expect.objectContaining({
            account_id: EXPENSE_ACCOUNT_ID,
            debit: 0,
            credit: 600,
          }),
          expect.objectContaining({
            account_id: RETAINED_EARNINGS_ID,
            debit: 0,
            credit: 400,
          }),
        ]),
      );
      expect(repository.postEntry).toHaveBeenCalledWith(ENTRY_ID);
      expect(result.entry.entry_type).toBe(JournalEntryType.YearEndClosing);
      expect(result.entry.status).toBe(JournalEntryStatus.Posted);
      const totalDebit = result.lines.reduce((sum, line) => sum + line.debit, 0);
      const totalCredit = result.lines.reduce((sum, line) => sum + line.credit, 0);
      expect(totalDebit).toBe(totalCredit);
    });

    it('attempting year-end close a second time for the same fiscal year is rejected cleanly', async () => {
      repository.hasYearEndClosingForFiscalYear.mockResolvedValue(true);

      await expect(service.runYearEndClosing(yearEndDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.runYearEndClosing(yearEndDto)).rejects.toThrow(
        `A year-end closing entry already exists for fiscal year ${FISCAL_YEAR}`,
      );
      expect(repository.insertYearEndClosingDraft).not.toHaveBeenCalled();
      expect(repository.postEntry).not.toHaveBeenCalled();
    });
  });
});
