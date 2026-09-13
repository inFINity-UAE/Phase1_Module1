import { CreateGoodsReceiptLineDto } from './dto/create-goods-receipt-line.dto';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { UpdateGoodsReceiptLineDto } from './dto/update-goods-receipt-line.dto';
import { UpdateGoodsReceiptDto } from './dto/update-goods-receipt.dto';
import { GoodsReceiptLine } from './entities/goods-receipt-line.entity';
import { GoodsReceiptWithLines } from './entities/goods-receipt-with-lines.entity';
import { GoodsReceipt } from './entities/goods-receipt.entity';

export const GOODS_RECEIPTS_REPOSITORY = Symbol('GOODS_RECEIPTS_REPOSITORY');

export interface InsertGoodsReceiptParams extends CreateGoodsReceiptDto {
  created_by: string;
}

export interface GoodsReceiptsRepository {
  insertHeader(params: InsertGoodsReceiptParams): Promise<GoodsReceipt>;
  findAll(companyId: string): Promise<GoodsReceipt[]>;
  findByIdWithLines(id: string): Promise<GoodsReceiptWithLines | null>;
  updateHeader(id: string, patch: UpdateGoodsReceiptDto): Promise<GoodsReceipt>;
  deleteHeader(id: string): Promise<void>;
  insertLine(goodsReceiptId: string, dto: CreateGoodsReceiptLineDto): Promise<GoodsReceiptLine>;
  updateLine(id: string, dto: UpdateGoodsReceiptLineDto): Promise<GoodsReceiptLine>;
  deleteLine(id: string): Promise<void>;
  findLineById(lineId: string): Promise<GoodsReceiptLine | null>;
  findPurchaseOrderCompanyId(poId: string): Promise<string | null>;
}
