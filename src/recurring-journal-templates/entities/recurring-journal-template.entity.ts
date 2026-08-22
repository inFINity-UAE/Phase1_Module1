/** Row shape of public.recurring_journal_templates — [schema.sql] */
export class RecurringJournalTemplate {
  id!: string;
  company_id!: string;
  template_name!: string;
  narration_template!: string;
  frequency!: string;
  start_date!: string;
  end_date!: string | null;
  next_run_date!: string;
  day_of_month!: number | null;
  auto_post!: boolean;
  is_active!: boolean;
  created_by!: string;
  created_at!: string;
  updated_at!: string;
}
