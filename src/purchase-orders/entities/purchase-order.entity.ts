import { PoStatus } from '../common/enums/po-status.enum';

/** Row shape for `purchase_orders` — [feature-spec-1_1_E.md §3.4]. */
export class PurchaseOrder {
  id!: string;
  company_id!: string;
  supplier_id!: string;
  po_number!: string;
  po_date!: string;
  status!: PoStatus;
  created_by!: string;
  created_at!: string;
  updated_at!: string;
}
