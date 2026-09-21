import { IsUUID } from 'class-validator';
import { ReportFormatQuery } from './report-format';

/** [feature-spec-1.1.H2.md H2-8] Period-bounded FS bundle. */
export class AuditPackQueryDto extends ReportFormatQuery {
  @IsUUID()
  company_id!: string;

  @IsUUID()
  period_id!: string;
}
