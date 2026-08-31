import { IsBoolean, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

export class UpdateInvoiceLineDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  line_number?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  quantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unit_price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  discount_percent?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  discount_amount?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  vat_rate?: number;

  @IsOptional()
  @IsBoolean()
  is_service?: boolean;

  @IsOptional()
  @IsPostgresUuid()
  income_account_id?: string | null;
}
