import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

/** [feature-spec-1_1_D.md §3.1b] Company-scoped holiday create — never UAE-wide. */
export class CreatePublicHolidayDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsDateString()
  holiday_date!: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsOptional()
  @IsString()
  source?: string | null;
}
