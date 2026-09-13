import { IsOptional } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

/** [feature-spec-1_1_E.md E-22] Confirm a suggested bill or payment match. */
export class ConfirmSupplierStatementMatchDto {
  @IsOptional()
  @IsPostgresUuid()
  matched_bill_id?: string | null;

  @IsOptional()
  @IsPostgresUuid()
  matched_payment_id?: string | null;
}
