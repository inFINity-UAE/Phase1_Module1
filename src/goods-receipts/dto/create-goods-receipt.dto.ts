import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsOptional, ValidateNested } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';
import { CreateGoodsReceiptLineDto } from './create-goods-receipt-line.dto';

/** [feature-spec-1_1_E.md §3.6 / §5.5] Number assigned at insert by DB trigger. */
export class CreateGoodsReceiptDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsPostgresUuid()
  supplier_id!: string;

  @IsPostgresUuid()
  purchase_order_id!: string;

  @IsDateString()
  receipt_date!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGoodsReceiptLineDto)
  lines?: CreateGoodsReceiptLineDto[];
}
