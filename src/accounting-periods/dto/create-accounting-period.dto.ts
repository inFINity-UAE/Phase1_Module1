import { IsDateString, IsInt } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

/**
 * Create accounting period — [schema.sql accounting_periods].
 * Writable columns only: company_id, period_start, period_end, fiscal_year.
 * status defaults to 'open' in the DB — not client-settable (soft-close is the
 * only status transition path — [feature-spec.md decision #21 / #30]).
 * No soft_closed_by / closed_by / reopened_by — those are session-derived on
 * soft-close / reserved hard-close-reopen flows only ([decisions #10/#11]).
 */
export class CreateAccountingPeriodDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsDateString()
  period_start!: string;

  @IsDateString()
  period_end!: string;

  @IsInt()
  fiscal_year!: number;
}
