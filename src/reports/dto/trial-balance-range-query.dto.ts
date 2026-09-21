import { IsBoolean, IsDateString, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { ReportFormatQuery } from './report-format';

/** [feature-spec-1.1.H.md H2-2] Additive range TB — period_id route unchanged. */
export class TrialBalanceRangeQueryDto extends ReportFormatQuery {
  @IsUUID()
  company_id!: string;

  @IsDateString({ strict: true })
  range_start!: string;

  @IsDateString({ strict: true })
  range_end!: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    if (value === true || value === 'true' || value === '1') {
      return true;
    }
    if (value === false || value === 'false' || value === '0') {
      return false;
    }
    return value;
  })
  @IsBoolean()
  include_zero_balance?: boolean;
}
