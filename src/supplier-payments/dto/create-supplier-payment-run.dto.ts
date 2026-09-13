import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';
import { PaymentMethodType } from '../../payments/common/enums/payment-method-type.enum';

export class CreateSupplierPaymentRunItemDto {
  @IsPostgresUuid()
  bill_id!: string;

  @IsPostgresUuid()
  supplier_id!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount_to_pay!: number;

  @IsOptional()
  @IsBoolean()
  included?: boolean;
}

/** [feature-spec-1_1_E.md §4.3] Draft payment run + selected bills. */
export class CreateSupplierPaymentRunDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsDateString()
  run_date!: string;

  @IsEnum(PaymentMethodType)
  payment_method!: PaymentMethodType;

  @IsOptional()
  @IsPostgresUuid()
  bank_account_id?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSupplierPaymentRunItemDto)
  items!: CreateSupplierPaymentRunItemDto[];
}
