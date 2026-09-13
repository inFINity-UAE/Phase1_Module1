import { IsDateString, IsOptional } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

export class UpdateGoodsReceiptDto {
  @IsOptional()
  @IsPostgresUuid()
  supplier_id?: string;

  @IsOptional()
  @IsPostgresUuid()
  purchase_order_id?: string;

  @IsOptional()
  @IsDateString()
  receipt_date?: string;
}
