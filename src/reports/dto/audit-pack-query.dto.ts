import { IsUUID } from 'class-validator';
import { ReportFormatQuery } from './report-format';

/** [feature-spec-1_1_H.md H2-8] Period-bounded FS bundle. */
export class AuditPackQueryDto extends ReportFormatQuery {
  @IsUUID()
  company_id!: string;

  @IsUUID()
  period_id!: string;
}
