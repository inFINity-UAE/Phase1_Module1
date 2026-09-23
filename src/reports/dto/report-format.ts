import { IsIn, IsOptional } from 'class-validator';

/** [feature-spec-1_1_H.md H2-7] CSV serialization query flag. */
export class ReportFormatQuery {
  @IsOptional()
  @IsIn(['csv'])
  format?: 'csv';
}
