import { IsDateString, IsUUID } from 'class-validator';
import { ReportFormatQuery } from './report-format';

/** [feature-spec-1_1_H.md H2-6] Nest composition of BS / P&L / aged AR / AP. */
export class ExecutiveSummaryQueryDto extends ReportFormatQuery {
  @IsUUID()
  company_id!: string;

  @IsDateString({ strict: true })
  period_start!: string;

  @IsDateString({ strict: true })
  period_end!: string;
}
