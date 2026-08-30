import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/**
 * [feature-spec-1.1.H1.md decision #5] General Ledger query —
 * company_id required; account_id / date_from / date_to optional.
 */
export class GeneralLedgerQueryDto {
  @IsUUID()
  company_id!: string;

  @IsOptional()
  @IsUUID()
  account_id?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  date_from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  date_to?: string;
}
