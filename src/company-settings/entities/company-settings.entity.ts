/** Row shape of public.company_settings — [schema.sql] */
export class CompanySettings {
  company_id!: string;
  journal_approval_threshold!: number | null;
  /** [feature-spec-1_1_D.md D-11] write_off entries; default AED 5,000 */
  write_off_approval_threshold!: number;
  approval_threshold_currency!: string;
  default_period_length!: string;
  allow_period_reopen!: boolean;
  updated_at!: string;
}
