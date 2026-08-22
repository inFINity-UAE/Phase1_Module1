/** Row shape of public.company_settings — [schema.sql] */
export class CompanySettings {
  company_id!: string;
  journal_approval_threshold!: number | null;
  approval_threshold_currency!: string;
  default_period_length!: string;
  allow_period_reopen!: boolean;
  updated_at!: string;
}
