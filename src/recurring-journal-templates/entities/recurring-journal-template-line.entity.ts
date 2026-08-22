/** Row shape of public.recurring_journal_template_lines — [schema.sql] */
export class RecurringJournalTemplateLine {
  id!: string;
  template_id!: string;
  line_number!: number;
  account_id!: string;
  debit!: number;
  credit!: number;
  description!: string | null;
}
