import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/** [feature-spec-1_1_D.md §5.1 / §5.4] Customer ledger / statement query. */
export class CustomerLedgerQueryDto {
  @IsUUID()
  company_id!: string;

  @IsUUID()
  customer_id!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  date_from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  date_to?: string;
}
