import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/** [feature-spec-1_1_E.md §5.1] Supplier ledger query. */
export class SupplierLedgerQueryDto {
  @IsUUID()
  company_id!: string;

  @IsUUID()
  supplier_id!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  date_from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  date_to?: string;
}
