import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';
import { PaymentMethodType } from '../../payments/common/enums/payment-method-type.enum';

export class UpdateSupplierPaymentDto {
  @IsOptional()
  @IsDateString()
  payment_date?: string;

  @IsOptional()
  @IsEnum(PaymentMethodType)
  payment_method?: PaymentMethodType | null;

  @IsOptional()
  @IsString()
  reference_number?: string | null;

  @IsOptional()
  @IsPostgresUuid()
  bank_account_id?: string | null;
}
