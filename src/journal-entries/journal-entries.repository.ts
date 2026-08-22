import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { UpdateJournalLineDto } from './dto/update-journal-line.dto';
import { JournalEntryWithDetails } from './entities/journal-entry-with-details.entity';
import { JournalAttachment } from './entities/journal-attachment.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalLine } from './entities/journal-line.entity';
import { TrialBalanceTotals } from './entities/trial-balance-totals.entity';

export const JOURNAL_ENTRIES_REPOSITORY = Symbol('JOURNAL_ENTRIES_REPOSITORY');

export interface JournalEntriesRepository {
  getNextEntryNumber(companyId: string): Promise<number>;
  insertDraft(dto: CreateJournalEntryDto): Promise<JournalEntryWithDetails>;
  findByIdWithDetails(id: string): Promise<JournalEntryWithDetails | null>;
  findAttachmentsByEntryId(entryId: string): Promise<JournalAttachment[]>;
  postEntry(id: string): Promise<JournalEntry>;
  updateLine(id: string, dto: UpdateJournalLineDto): Promise<JournalLine>;
  deleteLine(id: string): Promise<void>;
  getTrialBalanceTotals(companyId: string): Promise<TrialBalanceTotals>;
}
