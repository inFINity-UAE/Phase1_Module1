import { PurchaseOrderLine } from './purchase-order-line.entity';
import { PurchaseOrder } from './purchase-order.entity';

export class PurchaseOrderWithLines {
  purchase_order!: PurchaseOrder;
  lines!: PurchaseOrderLine[];
}
