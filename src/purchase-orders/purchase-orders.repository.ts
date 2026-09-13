import { CreatePurchaseOrderLineDto } from './dto/create-purchase-order-line.dto';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderLineDto } from './dto/update-purchase-order-line.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';
import { PurchaseOrderWithLines } from './entities/purchase-order-with-lines.entity';
import { PurchaseOrder } from './entities/purchase-order.entity';

export const PURCHASE_ORDERS_REPOSITORY = Symbol('PURCHASE_ORDERS_REPOSITORY');

export interface InsertPurchaseOrderParams extends CreatePurchaseOrderDto {
  created_by: string;
}

export interface PurchaseOrdersRepository {
  insertHeader(params: InsertPurchaseOrderParams): Promise<PurchaseOrder>;
  findAll(companyId: string): Promise<PurchaseOrder[]>;
  findByIdWithLines(id: string): Promise<PurchaseOrderWithLines | null>;
  updateHeader(id: string, patch: UpdatePurchaseOrderDto): Promise<PurchaseOrder>;
  deleteHeader(id: string): Promise<void>;
  insertLine(poId: string, dto: CreatePurchaseOrderLineDto): Promise<PurchaseOrderLine>;
  updateLine(id: string, dto: UpdatePurchaseOrderLineDto): Promise<PurchaseOrderLine>;
  deleteLine(id: string): Promise<void>;
  findLineById(lineId: string): Promise<PurchaseOrderLine | null>;
  findSupplierActive(supplierId: string): Promise<boolean | null>;
  findSupplierCompanyId(supplierId: string): Promise<string | null>;
}
