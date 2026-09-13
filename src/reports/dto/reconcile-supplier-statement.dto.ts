import { IsDateString, IsUUID } from 'class-validator';

/** [feature-spec-1_1_E.md §5.3 / E-22] Statement reconcile RPC body. */
export class ReconcileSupplierStatementDto {
  @IsUUID()
  company_id!: string;

  @IsUUID()
  supplier_id!: string;

  @IsDateString({ strict: true })
  statement_date!: string;
}
