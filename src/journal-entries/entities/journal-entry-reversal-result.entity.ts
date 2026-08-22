import { JournalEntryWithDetails } from './journal-entry-with-details.entity';

/** Result of reversing a posted journal entry — original + new reversal entry. */
export class JournalEntryReversalResult {
  original!: JournalEntryWithDetails;
  reversal!: JournalEntryWithDetails;
}
