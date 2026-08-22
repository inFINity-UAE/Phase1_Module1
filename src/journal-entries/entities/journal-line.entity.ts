/** Row shape of public.journal_lines — [schema.sql] */
export class JournalLine {
  id!: string;
  journal_entry_id!: string;
  line_number!: number;
  account_id!: string;
  debit!: number;
  credit!: number;
  description!: string | null;
  cost_center!: string | null;
  created_at!: string;
}
