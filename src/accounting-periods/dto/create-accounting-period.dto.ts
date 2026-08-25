import { IsDateString, IsEnum, IsInt, IsOptional } from 'class-validator';
import { PeriodStatus } from '../../common/enums/period-status.enum';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

/**
 * Create accounting period — [schema.sql accounting_periods].
 * [feature-spec.md decisions #10/#11] No soft_closed_by / closed_by / reopened_by
 * (or timestamps) — those are set by authenticated soft-close / reopen flows only.
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

  @IsOptional()
  @IsEnum(PeriodStatus)
  status?: PeriodStatus;
}
