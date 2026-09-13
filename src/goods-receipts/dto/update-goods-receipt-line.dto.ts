import { IsNumber, IsOptional, Min } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

export class UpdateGoodsReceiptLineDto {
  @IsOptional()
  @IsPostgresUuid()
  purchase_order_line_id?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  quantity_received?: number;
}
