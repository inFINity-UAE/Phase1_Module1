import { IsOptional, IsString, MinLength } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

/**
 * [feature-spec-1.1.C.md §1.1] Customer create — `trn` set at creation only
 * (decision #17); not re-enterable via PATCH.
 */
export class CreateCustomerDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsString()
  @MinLength(1)
  customer_name!: string;

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
  @IsString()
  default_payment_terms?: string | null;
}
