import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/** [feature-spec-1_1_D.md §5.2] Aged receivables — as_of_date optional (server today). */
export class AgedReceivablesQueryDto {
  @IsUUID()
  company_id!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  as_of_date?: string;
}
