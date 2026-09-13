import { IsNumber, Min } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

export class CreateGoodsReceiptLineDto {
  @IsPostgresUuid()
  purchase_order_line_id!: string;

  @IsNumber()
  @Min(0.0001)
  quantity_received!: number;
}
