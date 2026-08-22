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

/** Writable columns of public.accounts. Required = NOT NULL with no default. [schema.sql] */
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
  is_system_account?: boolean;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  locked_at?: string;

  @IsOptional()
  @IsString()
  locked_reason?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
