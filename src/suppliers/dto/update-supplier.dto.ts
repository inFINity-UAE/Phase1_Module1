import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength, ValidateIf } from 'class-validator';
import { PaymentTermsType } from '../../invoices/common/enums/payment-terms-type.enum';

/**
 * [feature-spec-1_1_E.md §3.1] Metadata-only PATCH — `trn` and `company_id`
 * are intentionally excluded (immutable after create).
 */
export class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  supplier_name?: string;

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

  @ValidateIf((dto: UpdateSupplierDto) => dto.default_payment_terms === PaymentTermsType.Custom)
  @IsOptional()
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
