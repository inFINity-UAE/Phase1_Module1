import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { JournalEntryWithDetails } from './entities/journal-entry-with-details.entity';
import { JournalAttachment } from './entities/journal-attachment.entity';

export const JOURNAL_ENTRIES_REPOSITORY = Symbol('JOURNAL_ENTRIES_REPOSITORY');

export interface JournalEntriesRepository {
  getNextEntryNumber(companyId: string): Promise<number>;
  insertDraft(dto: CreateJournalEntryDto): Promise<JournalEntryWithDetails>;
  findByIdWithDetails(id: string): Promise<JournalEntryWithDetails | null>;
  findAttachmentsByEntryId(entryId: string): Promise<JournalAttachment[]>;
}
