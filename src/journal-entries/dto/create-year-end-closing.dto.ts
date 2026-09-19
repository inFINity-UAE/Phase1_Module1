import { IsBoolean, IsDateString, IsInt, IsOptional, IsString } from 'class-validator';
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

  /** [feature-spec-1_1_G.md G-22 / G-32] Owner-only skip of the CT provision gate. */
  @IsOptional()
  @IsBoolean()
  skip_ct_check?: boolean;

  @IsOptional()
  @IsString()
  skip_reason?: string;
}
