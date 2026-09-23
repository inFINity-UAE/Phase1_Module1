import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * [feature-spec-1_1_C.md decision #17] Metadata-only PATCH — `trn` and
 * `company_id` are intentionally excluded (immutable after create).
 */
export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  customer_name?: string;

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
  @IsString()
  default_payment_terms?: string | null;
}
