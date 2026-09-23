import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { ReportFormatQuery } from './report-format';

/**
 * [feature-spec-1_1_H.md decision #5] General Ledger query —
 * company_id required; account_id / date_from / date_to optional.
 * [feature-spec-1_1_H.md H2-3] limit / offset optional.
 */
export class GeneralLedgerQueryDto extends ReportFormatQuery {
  @IsUUID()
  company_id!: string;

  @IsOptional()
  @IsUUID()
  account_id?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  date_from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  date_to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
