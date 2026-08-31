import { IsDateString, IsOptional, IsString } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

/** Draft-only header metadata — totals and status are not patchable here. */
export class UpdateQuotationDto {
  @IsOptional()
  @IsPostgresUuid()
  customer_id?: string;

  @IsOptional()
  @IsDateString()
  quotation_date?: string;

  @IsOptional()
  @IsDateString()
  valid_until?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}
