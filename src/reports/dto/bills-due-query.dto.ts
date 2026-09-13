import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/** [feature-spec-1_1_E.md §5.2 / §5.4] Bills-due listing. */
export class BillsDueQueryDto {
  @IsUUID()
  company_id!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  as_of_date?: string;
}
