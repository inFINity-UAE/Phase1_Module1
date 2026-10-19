import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const EMIRATES = [
  'abu_dhabi',
  'dubai',
  'sharjah',
  'ajman',
  'umm_al_quwain',
  'ras_al_khaimah',
  'fujairah',
] as const;

const CURRENCIES = ['AED', 'USD', 'EUR', 'GBP'] as const;

/** A customer typed during setup. Catalog lines are not accepted. */
export class OnboardingCustomerDto {
  @IsString()
  @MinLength(1)
  customer_name!: string;

  @IsOptional()
  @Matches(/^\d{15}$/)
  trn?: string | null;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @Matches(/^\+[1-9]\d{7,14}$/)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  billing_address?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  credit_limit?: number | null;
}

/**
 * Body of POST /onboarding/workspace. The user id is not a field —
 * the handler reads it from the verified JWT.
 */
export class OnboardWorkspaceDto {
  @IsString()
  @MinLength(1)
  legal_name!: string;

  @IsOptional()
  @Matches(/^\d{15}$/)
  trn?: string | null;

  @IsIn(CURRENCIES)
  base_currency!: (typeof CURRENCIES)[number];

  @IsBoolean()
  is_free_zone_entity!: boolean;

  @IsInt()
  @Min(1)
  @Max(12)
  fiscal_year_start_month!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  journal_approval_threshold?: number | null;

  @IsIn(['monthly', 'quarterly'])
  default_period_length!: 'monthly' | 'quarterly';

  @IsBoolean()
  allow_period_reopen!: boolean;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  write_off_approval_threshold!: number;

  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  weekend_days!: number[];

  @IsIn(['monthly', 'quarterly'])
  vat_return_frequency!: 'monthly' | 'quarterly';

  @IsOptional()
  @IsIn(EMIRATES)
  default_emirate?: (typeof EMIRATES)[number] | null;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OnboardingCustomerDto)
  customers!: OnboardingCustomerDto[];
}
