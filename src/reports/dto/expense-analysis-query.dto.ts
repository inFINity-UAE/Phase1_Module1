import { Type } from 'class-transformer';
import { IsInt, IsUUID } from 'class-validator';
import { ReportFormatQuery } from './report-format';

/** [feature-spec-1.1.H.md H2-4] Expense MoM by COA sub_category. */
export class ExpenseAnalysisQueryDto extends ReportFormatQuery {
  @IsUUID()
  company_id!: string;

  @Type(() => Number)
  @IsInt()
  fiscal_year!: number;
}
