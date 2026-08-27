import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { AccountCategory } from '../../common/enums/account-category.enum';
import { NormalBalance } from '../../common/enums/normal-balance.enum';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

/**
 * Client-writable columns for custom account create.
 * [feature-spec.md §7.16 finding #2 / decision #42] is_system_account,
 * locked_at, and locked_reason are system-controlled only — not on this DTO
 * (forbidNonWhitelisted rejects them with 400).
 */
export class CreateAccountDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsString()
  @Length(4, 4)
  account_number!: string;

  @IsString()
  account_name!: string;

  @IsEnum(AccountCategory)
  category!: AccountCategory;

  @IsOptional()
  @IsString()
  sub_category?: string;

  @IsEnum(NormalBalance)
  normal_balance!: NormalBalance;

  @IsOptional()
  @IsPostgresUuid()
  parent_account_id?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  depth?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}
