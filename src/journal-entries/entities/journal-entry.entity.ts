import { JournalEntryType } from '../../common/enums/journal-entry-type.enum';
import { JournalEntryStatus } from '../../common/enums/journal-entry-status.enum';

/** Row shape of public.journal_entries — [schema.sql] */
export class JournalEntry {
  id!: string;
  company_id!: string;
  entry_number!: number;
  period_id!: string;
  entry_date!: string;
  entry_type!: JournalEntryType;
  status!: JournalEntryStatus;
  narration!: string;
  reference_number!: string | null;
  reverses_entry_id!: string | null;
  reversed_by_entry_id!: string | null;
  recurring_template_id!: string | null;
  requires_approval!: boolean;
  approved_by!: string | null;
  approved_at!: string | null;
  rejected_by!: string | null;
  rejected_at!: string | null;
  rejection_reason!: string | null;
  created_by!: string;
  posted_at!: string | null;
  created_at!: string;
  updated_at!: string;
}
