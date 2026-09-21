import { IsDateString, IsUUID } from 'class-validator';
import { ReportFormatQuery } from './report-format';

/**
 * [feature-spec-1.1.H1.md decision #3] P&L query — all three required.
 * Nest rejects period_end < period_start before the RPC.
 */
export class ProfitAndLossQueryDto extends ReportFormatQuery {
  @IsUUID()
  company_id!: string;

  @IsDateString({ strict: true })
  period_start!: string;

  @IsDateString({ strict: true })
  period_end!: string;
}
