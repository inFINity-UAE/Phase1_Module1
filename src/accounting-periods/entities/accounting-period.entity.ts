import { PeriodStatus } from '../../common/enums/period-status.enum';

/** Row shape of public.accounting_periods — [schema.sql] */
export class AccountingPeriod {
  id!: string;
  company_id!: string;
  period_start!: string;
  period_end!: string;
  fiscal_year!: number;
  status!: PeriodStatus;
  soft_closed_by!: string | null;
  soft_closed_at!: string | null;
  closed_by!: string | null;
  closed_at!: string | null;
  reopened_by!: string | null;
  reopened_at!: string | null;
  reopen_reason!: string | null;
  created_at!: string;
}
