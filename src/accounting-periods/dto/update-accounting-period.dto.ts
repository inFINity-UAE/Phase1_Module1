import { IsDateString, IsInt, IsOptional } from 'class-validator';

/**
 * Update accounting period — dates / fiscal_year only.
 * [feature-spec.md decision #30] status / company_id / soft_closed_* / closed_* /
 * reopen_* are forbidden (forbidNonWhitelisted). Soft-close stays the only
 * status-transition HTTP path.
 */
export class UpdateAccountingPeriodDto {
  @IsOptional()
  @IsDateString()
  period_start?: string;

  @IsOptional()
  @IsDateString()
  period_end?: string;

  @IsOptional()
  @IsInt()
  fiscal_year?: number;
}
