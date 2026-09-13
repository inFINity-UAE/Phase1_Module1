import { GoodsReceiptLine } from './goods-receipt-line.entity';
import { GoodsReceipt } from './goods-receipt.entity';

export class GoodsReceiptWithLines {
  goods_receipt!: GoodsReceipt;
  lines!: GoodsReceiptLine[];
}
