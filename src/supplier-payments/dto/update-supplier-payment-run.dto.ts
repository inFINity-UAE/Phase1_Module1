import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';
import { PaymentMethodType } from '../../payments/common/enums/payment-method-type.enum';

export class UpdateSupplierPaymentRunDto {
  @IsOptional()
  @IsDateString()
  run_date?: string;

  @IsOptional()
  @IsEnum(PaymentMethodType)
  payment_method?: PaymentMethodType;

  @IsOptional()
  @IsPostgresUuid()
  bank_account_id?: string | null;
}
