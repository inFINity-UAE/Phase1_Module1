import { IsDateString, IsIn, IsOptional } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';
import { PoStatus } from '../common/enums/po-status.enum';

/** Manual status is only `cancelled` / `closed` — [feature-spec-1_1_E.md §3.4]. */
export class UpdatePurchaseOrderDto {
  @IsOptional()
  @IsPostgresUuid()
  supplier_id?: string;

  @IsOptional()
  @IsDateString()
  po_date?: string;

  @IsOptional()
  @IsIn([PoStatus.Cancelled, PoStatus.Closed])
  status?: PoStatus.Cancelled | PoStatus.Closed;
}
