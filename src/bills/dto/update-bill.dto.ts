import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Min, ValidateIf } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';
import { PaymentTermsType } from '../../invoices/common/enums/payment-terms-type.enum';

export class UpdateBillDto {
  @IsOptional()
  @IsPostgresUuid()
  supplier_id?: string;

  @IsOptional()
  @IsString()
  supplier_invoice_number?: string | null;

  @IsOptional()
  @IsPostgresUuid()
  purchase_order_id?: string | null;

  @IsOptional()
  @IsDateString()
  bill_date?: string;

  @IsOptional()
  @IsEnum(PaymentTermsType)
  payment_terms?: PaymentTermsType;

  @ValidateIf((dto: UpdateBillDto) => dto.payment_terms === PaymentTermsType.Custom)
  @IsOptional()
  @IsInt()
  @Min(1)
  custom_days?: number | null;
}
