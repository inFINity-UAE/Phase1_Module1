import { IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

export class CreateBillLineDto {
  @IsNumber()
  @Min(1)
  line_number!: number;

  @IsOptional()
  @IsPostgresUuid()
  purchase_order_line_id?: string | null;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unit_price!: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  discount_percent?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  discount_amount?: number | null;

  @IsNumber()
  @Min(0)
  @Max(100)
  vat_rate!: number;

  @IsOptional()
  @IsPostgresUuid()
  account_id?: string | null;
}
