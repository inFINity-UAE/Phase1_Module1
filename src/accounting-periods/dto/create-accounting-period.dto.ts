import { IsDateString, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { PeriodStatus } from '../../common/enums/period-status.enum';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

/** Writable columns of public.accounting_periods. Required = NOT NULL with no default. [schema.sql] */
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

  @IsOptional()
  @IsPostgresUuid()
  soft_closed_by?: string;

  @IsOptional()
  @IsDateString()
  soft_closed_at?: string;

  @IsOptional()
  @IsPostgresUuid()
  closed_by?: string;

  @IsOptional()
  @IsDateString()
  closed_at?: string;

  @IsOptional()
  @IsPostgresUuid()
  reopened_by?: string;

  @IsOptional()
  @IsDateString()
  reopened_at?: string;

  @IsOptional()
  @IsString()
  reopen_reason?: string;
}
