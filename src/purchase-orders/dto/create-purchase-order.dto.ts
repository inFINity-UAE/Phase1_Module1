import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsOptional, ValidateNested } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';
import { CreatePurchaseOrderLineDto } from './create-purchase-order-line.dto';

/** [feature-spec-1_1_E.md §3.4 / §5.5] Number assigned at insert by DB trigger. */
export class CreatePurchaseOrderDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsPostgresUuid()
  supplier_id!: string;

  @IsDateString()
  po_date!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderLineDto)
  lines?: CreatePurchaseOrderLineDto[];
}
