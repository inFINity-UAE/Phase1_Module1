import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/** [feature-spec-1_1_E.md §5.2] Aged payables — as_of_date optional (server today). */
export class AgedPayablesQueryDto {
  @IsUUID()
  company_id!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  as_of_date?: string;
}
