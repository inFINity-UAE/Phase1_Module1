import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';
import { CtIncomeAdjustmentType } from '../../common/enums/ct-income-adjustment-type.enum';
import { RelatedPartyRelationship } from '../../common/enums/related-party-relationship.enum';

/** [feature-spec-1_1_G.md §5] company_id + fiscal_year query. */
export class CtCompanyYearQueryDto {
  @IsPostgresUuid()
  company_id!: string;

  @Type(() => Number)
  @IsInt()
  fiscal_year!: number;
}

export class CtCompanyQueryDto {
  @IsPostgresUuid()
  company_id!: string;
}

export class CtFiscalYearBodyDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsInt()
  fiscal_year!: number;
}

/** [feature-spec-1_1_G.md §4.5 / G-25] Manual rows only. */
export class CreateCtIncomeAdjustmentDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsInt()
  fiscal_year!: number;

  @IsEnum(CtIncomeAdjustmentType)
  adjustment_type!: CtIncomeAdjustmentType;

  @IsNumber()
  amount!: number;

  @IsOptional()
  @IsPostgresUuid()
  invoice_line_id?: string | null;

  @IsOptional()
  @IsPostgresUuid()
  journal_line_id?: string | null;

  @IsOptional()
  @IsPostgresUuid()
  journal_entry_id?: string | null;
}

/** [feature-spec-1_1_G.md §4.7 / G-26] */
export class RecordRelatedPartyTransactionDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsString()
  @MinLength(1)
  counterparty_name!: string;

  @IsEnum(RelatedPartyRelationship)
  relationship!: RelatedPartyRelationship;

  @IsString()
  @MinLength(1)
  transaction_type!: string;

  @IsNumber()
  amount!: number;

  @IsDateString()
  transaction_date!: string;

  @IsOptional()
  @IsPostgresUuid()
  reference_journal_entry_id?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}
