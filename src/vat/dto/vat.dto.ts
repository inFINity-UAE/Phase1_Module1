import { IsBoolean, IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

export class CalculateVatReturnDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsDateString()
  period_start!: string;
}

export class RecordVatPaymentDto {
  @IsNumber()
  amount!: number;

  @IsDateString()
  payment_date!: string;

  @IsString()
  @IsNotEmpty()
  method!: string;
}

export class AccrueVatPenaltyDto {
  @IsNumber()
  amount!: number;
}

export class CreateVatCorrectionDto {
  @IsNumber()
  delta_net_vat!: number;

  @IsOptional()
  @IsBoolean()
  emirate_mismatch?: boolean;

  @IsDateString()
  discovered_at!: string;

  @IsOptional()
  @IsString()
  error_description?: string;

  @IsOptional()
  corrected_figures?: Record<string, unknown>;
}

export class CreateCapitalGoodsProjectDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsString()
  @IsNotEmpty()
  asset_category!: string;
}

export class CreateCapitalGoodsItemDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsOptional()
  @IsPostgresUuid()
  project_id?: string | null;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsDateString()
  acquisition_date!: string;

  @IsNumber()
  capital_value!: number;

  @IsNumber()
  initial_vat!: number;

  @IsNumber()
  initial_recovery_pct!: number;

  @IsOptional()
  @IsNumber()
  adjustment_period_years?: number;

  @IsOptional()
  @IsString()
  period_override_reason?: string;

  @IsOptional()
  @IsPostgresUuid()
  bill_line_id?: string | null;
}

export class AdjustCapitalGoodsItemDto {
  @IsNumber()
  fiscal_year!: number;

  @IsNumber()
  actual_use_pct!: number;
}

export class CreateBadDebtReliefClaimDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsPostgresUuid()
  write_off_id!: string;
}
