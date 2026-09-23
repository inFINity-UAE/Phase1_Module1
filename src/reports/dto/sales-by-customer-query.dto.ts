import { IsDateString, IsUUID } from 'class-validator';
import { ReportFormatQuery } from './report-format';

/** [feature-spec-1_1_H.md H2-5 / H2-14] Invoice sales by customer, CNs netted. */
export class SalesByCustomerQueryDto extends ReportFormatQuery {
  @IsUUID()
  company_id!: string;

  @IsDateString({ strict: true })
  period_start!: string;

  @IsDateString({ strict: true })
  period_end!: string;
}
