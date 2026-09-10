/** [feature-spec-1_1_D.md §3.1b] Row shape of public.public_holidays */
export class PublicHoliday {
  id!: string;
  company_id!: string | null;
  holiday_date!: string;
  description!: string;
  status!: string;
  source!: string | null;
  created_at!: string;
  updated_at!: string;
}
