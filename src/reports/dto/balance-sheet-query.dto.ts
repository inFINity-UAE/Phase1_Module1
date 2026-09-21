import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import { ReportFormatQuery } from './report-format';

/**
 * [feature-spec-1.1.H.md decision #2] Balance Sheet query.
 * company_id required; as_of_date optional — Nest defaults to server today.
 */
export class BalanceSheetQueryDto extends ReportFormatQuery {
  @IsUUID()
  company_id!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  as_of_date?: string;
}
