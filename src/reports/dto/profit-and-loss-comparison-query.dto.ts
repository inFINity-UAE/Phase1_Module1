import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import { ReportFormatQuery } from './report-format';

/** [feature-spec-1_1_H.md H2-1] period_b optional → prior same-length range. */
export class ProfitAndLossComparisonQueryDto extends ReportFormatQuery {
  @IsUUID()
  company_id!: string;

  @IsDateString({ strict: true })
  period_a_start!: string;

  @IsDateString({ strict: true })
  period_a_end!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  period_b_start?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  period_b_end?: string;
}
