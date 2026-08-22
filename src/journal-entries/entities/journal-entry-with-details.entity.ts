import { JournalEntry } from './journal-entry.entity';
import { JournalLine } from './journal-line.entity';
import { JournalAttachment } from './journal-attachment.entity';

/** Journal entry with nested lines and attachments for read/create responses. */
export class JournalEntryWithDetails {
  entry!: JournalEntry;
  lines!: JournalLine[];
  attachments!: JournalAttachment[];
}
