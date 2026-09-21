import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { ReportFormatQuery } from './report-format';

/**
 * [feature-spec-1.1.H.md decision #1] Period Trial Balance query.
 * company_id + period_id required; include_zero_balance defaults false.
 */
export class TrialBalanceQueryDto extends ReportFormatQuery {
  @IsUUID()
  company_id!: string;

  @IsUUID()
  period_id!: string;

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
