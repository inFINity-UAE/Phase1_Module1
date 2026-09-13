import { IsNumber, IsString, Min, MinLength } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

export class CreatePurchaseOrderLineDto {
  @IsNumber()
  @Min(1)
  line_number!: number;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unit_price!: number;

  @IsPostgresUuid()
  account_id!: string;
}
