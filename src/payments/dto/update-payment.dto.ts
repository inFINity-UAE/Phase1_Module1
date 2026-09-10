import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';
import { PaymentMethodType } from '../common/enums/payment-method-type.enum';

/** Header patch — only while journal_entry_id is null. */
export class UpdatePaymentDto {
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
