import { IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

export class UpdatePurchaseOrderLineDto {
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
  @IsPostgresUuid()
  account_id?: string;
}
