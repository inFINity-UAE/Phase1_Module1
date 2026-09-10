import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';
import { PaymentMethodType } from '../common/enums/payment-method-type.enum';

export class CreatePaymentApplicationItemDto {
  @IsPostgresUuid()
  invoice_id!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  applied_amount!: number;
}

/** [feature-spec-1_1_D.md §4.2 / §4.3] Create payment; optional applications = invoice receipt. */
export class CreatePaymentDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsPostgresUuid()
  customer_id!: string;

  @IsDateString()
  payment_date!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsEnum(PaymentMethodType)
  payment_method?: PaymentMethodType;

  @IsOptional()
  @IsString()
  reference_number?: string | null;

  @IsOptional()
  @IsPostgresUuid()
  bank_account_id?: string | null;

  /** §4.2 — one payment can fund several invoices in the same create. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePaymentApplicationItemDto)
  applications?: CreatePaymentApplicationItemDto[];
}
