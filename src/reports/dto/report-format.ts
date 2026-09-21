import { IsIn, IsOptional } from 'class-validator';

/** [feature-spec-1.1.H2.md H2-7] CSV serialization query flag. */
export class ReportFormatQuery {
  @IsOptional()
  @IsIn(['csv'])
  format?: 'csv';
}
