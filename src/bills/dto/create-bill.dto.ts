import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';
import { PaymentTermsType } from '../../invoices/common/enums/payment-terms-type.enum';
import { CreateBillLineDto } from './create-bill-line.dto';

export class CreateBillDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsPostgresUuid()
  supplier_id!: string;

  @IsOptional()
  @IsString()
  supplier_invoice_number?: string | null;

  @IsOptional()
  @IsPostgresUuid()
  purchase_order_id?: string | null;

  @IsDateString()
  bill_date!: string;

  @IsOptional()
  @IsEnum(PaymentTermsType)
  payment_terms?: PaymentTermsType;

  @ValidateIf((dto: CreateBillDto) => dto.payment_terms === PaymentTermsType.Custom)
  @IsInt()
  @Min(1)
  custom_days?: number | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBillLineDto)
  lines?: CreateBillLineDto[];
}
