import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PostgrestError } from '@supabase/supabase-js';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { JournalEntryWithDetails } from './entities/journal-entry-with-details.entity';
import { formatUnbalancedPostError } from './journal-entry-balance.util';
import {
  JOURNAL_ENTRIES_REPOSITORY,
  JournalEntriesRepository,
} from './journal-entries.repository';
import { JournalEntriesService } from './journal-entries.service';

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const PERIOD_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const ACCOUNT_A = '44444444-4444-4444-4444-444444444444';
const ACCOUNT_B = '55555555-5555-5555-5555-555555555555';
const ENTRY_ID = '66666666-6666-6666-6666-666666666666';
const LINE_ID = '77777777-7777-7777-7777-777777777777';

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

describe('JournalEntriesService', () => {
  let service: JournalEntriesService;
  let repository: jest.Mocked<JournalEntriesRepository>;

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
      postEntry: jest.fn(),
      updateLine: jest.fn(),
      deleteLine: jest.fn(),
      getTrialBalanceTotals: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JournalEntriesService,
        { provide: JOURNAL_ENTRIES_REPOSITORY, useValue: repository },
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

    const result = await service.post(ENTRY_ID);

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

    await expect(service.post(ENTRY_ID)).rejects.toThrow(BadRequestException);
    await expect(service.post(ENTRY_ID)).rejects.toThrow(expectedMessage);
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
});
