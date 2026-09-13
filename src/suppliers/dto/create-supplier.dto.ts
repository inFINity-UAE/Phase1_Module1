import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength, ValidateIf } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';
import { PaymentTermsType } from '../../invoices/common/enums/payment-terms-type.enum';

/**
 * [feature-spec-1_1_E.md §3.1] Supplier create — `trn` set at creation only
 * (C #17 mirror); not re-enterable via PATCH.
 */
export class CreateSupplierDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsString()
  @MinLength(1)
  supplier_name!: string;

  @IsOptional()
  @IsString()
  trn?: string | null;

  @IsOptional()
  @IsString()
  email?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsString()
  billing_address?: string | null;

  @IsOptional()
  @IsEnum(PaymentTermsType)
  default_payment_terms?: PaymentTermsType;

  @ValidateIf((dto: CreateSupplierDto) => dto.default_payment_terms === PaymentTermsType.Custom)
  @IsInt()
  @Min(1)
  custom_days?: number | null;

  @IsOptional()
  @IsString()
  bank_name?: string | null;

  @IsOptional()
  @IsString()
  iban?: string | null;
}
