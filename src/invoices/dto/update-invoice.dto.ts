import { IsDateString, IsEnum, IsInt, IsOptional, Min, ValidateIf } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';
import { PaymentTermsType } from '../common/enums/payment-terms-type.enum';

export class UpdateInvoiceDto {
  @IsOptional()
  @IsPostgresUuid()
  customer_id?: string;

  @IsOptional()
  @IsDateString()
  invoice_date?: string;

  @IsOptional()
  @IsEnum(PaymentTermsType)
  payment_terms?: PaymentTermsType;

  @ValidateIf((dto: UpdateInvoiceDto) => dto.payment_terms === PaymentTermsType.Custom)
  @IsOptional()
  @IsInt()
  @Min(1)
  custom_days?: number | null;
}
