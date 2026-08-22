import { IsDateString, IsInt, IsOptional, IsString } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

/** Year-end P&L close — [feature-spec] [Rules §4.11]. */
export class CreateYearEndClosingDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsInt()
  fiscal_year!: number;

  @IsOptional()
  @IsDateString()
  entry_date?: string;

  @IsOptional()
  @IsString()
  narration?: string;

  @IsPostgresUuid()
  created_by!: string;
}
