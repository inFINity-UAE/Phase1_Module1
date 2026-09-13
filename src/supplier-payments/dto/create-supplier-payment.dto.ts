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
import { PaymentMethodType } from '../../payments/common/enums/payment-method-type.enum';

export class CreateSupplierPaymentApplicationItemDto {
  @IsPostgresUuid()
  bill_id!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  applied_amount!: number;
}

/** [feature-spec-1_1_E.md §4.5] Create payment; optional applications = AP receipt. */
export class CreateSupplierPaymentDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsPostgresUuid()
  supplier_id!: string;

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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSupplierPaymentApplicationItemDto)
  applications?: CreateSupplierPaymentApplicationItemDto[];
}
