import { JournalEntryWithDetails } from '../../journal-entries/entities/journal-entry-with-details.entity';

/** Outcome of generating one recurring template run. */
export class RecurringGenerationResult {
  template_id!: string;
  template_name!: string;
  journal_entry!: JournalEntryWithDetails | null;
  posted!: boolean;
  next_run_date!: string;
  error?: string;
}
