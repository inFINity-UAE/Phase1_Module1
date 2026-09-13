import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { handleDatabaseError } from '../common/errors/database-error.mapper';
import { PoStatus } from './common/enums/po-status.enum';
import { CreatePurchaseOrderLineDto } from './dto/create-purchase-order-line.dto';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderLineDto } from './dto/update-purchase-order-line.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';
import { PurchaseOrderWithLines } from './entities/purchase-order-with-lines.entity';
import { PurchaseOrder } from './entities/purchase-order.entity';
import {
  PURCHASE_ORDERS_REPOSITORY,
  PurchaseOrdersRepository,
} from './purchase-orders.repository';

@Injectable()
export class PurchaseOrdersService {
  constructor(
    @Inject(PURCHASE_ORDERS_REPOSITORY)
    private readonly purchaseOrdersRepository: PurchaseOrdersRepository,
  ) {}

  async create(dto: CreatePurchaseOrderDto, createdBy: string): Promise<PurchaseOrderWithLines> {
    await this.assertSupplierUsable(dto.supplier_id, dto.company_id);

    try {
      const header = await this.purchaseOrdersRepository.insertHeader({
        ...dto,
        created_by: createdBy,
      });

      for (const line of dto.lines ?? []) {
        await this.purchaseOrdersRepository.insertLine(header.id, line);
      }

      return this.findOne(header.id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findAll(companyId: string): Promise<PurchaseOrder[]> {
    try {
      return await this.purchaseOrdersRepository.findAll(companyId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findOne(id: string): Promise<PurchaseOrderWithLines> {
    try {
      const result = await this.purchaseOrdersRepository.findByIdWithLines(id);
      if (!result) {
        throw new NotFoundException(`Purchase order ${id} not found`);
      }
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      handleDatabaseError(error);
    }
  }

  async update(id: string, dto: UpdatePurchaseOrderDto): Promise<PurchaseOrderWithLines> {
    const current = await this.findOne(id);
    this.assertOpen(current.purchase_order, 'update');

    if (dto.supplier_id && dto.supplier_id !== current.purchase_order.supplier_id) {
      await this.assertSupplierUsable(dto.supplier_id, current.purchase_order.company_id);
    }

    const hasPatch =
      dto.supplier_id !== undefined || dto.po_date !== undefined || dto.status !== undefined;
    if (!hasPatch) {
      throw new BadRequestException('No updatable fields provided');
    }

    try {
      await this.purchaseOrdersRepository.updateHeader(id, dto);
      return this.findOne(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async remove(id: string): Promise<void> {
    const current = await this.findOne(id);
    this.assertOpen(current.purchase_order, 'delete');
    try {
      await this.purchaseOrdersRepository.deleteHeader(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async createLine(poId: string, dto: CreatePurchaseOrderLineDto): Promise<PurchaseOrderLine> {
    const current = await this.findOne(poId);
    this.assertOpen(current.purchase_order, 'add lines to');

    try {
      return await this.purchaseOrdersRepository.insertLine(poId, dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async updateLine(
    poId: string,
    lineId: string,
    dto: UpdatePurchaseOrderLineDto,
  ): Promise<PurchaseOrderLine> {
    const current = await this.findOne(poId);
    this.assertOpen(current.purchase_order, 'update lines on');
    await this.requireLineOnParent(poId, lineId);

    try {
      return await this.purchaseOrdersRepository.updateLine(lineId, dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async deleteLine(poId: string, lineId: string): Promise<void> {
    const current = await this.findOne(poId);
    this.assertOpen(current.purchase_order, 'delete lines from');
    await this.requireLineOnParent(poId, lineId);

    try {
      await this.purchaseOrdersRepository.deleteLine(lineId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  private assertOpen(purchaseOrder: PurchaseOrder, action: string): void {
    if (purchaseOrder.status !== PoStatus.Open) {
      throw new BadRequestException(
        `Cannot ${action} purchase order ${purchaseOrder.po_number} — status is ${purchaseOrder.status}`,
      );
    }
  }

  private async requireLineOnParent(poId: string, lineId: string): Promise<PurchaseOrderLine> {
    const line = await this.purchaseOrdersRepository.findLineById(lineId);
    if (!line || line.po_id !== poId) {
      throw new NotFoundException(`Purchase order line ${lineId} not found on purchase order ${poId}`);
    }
    return line;
  }

  private async assertSupplierUsable(supplierId: string, companyId: string): Promise<void> {
    const supplierCompanyId = await this.purchaseOrdersRepository.findSupplierCompanyId(supplierId);
    if (!supplierCompanyId) {
      throw new NotFoundException(`Supplier ${supplierId} not found`);
    }
    if (supplierCompanyId !== companyId) {
      throw new BadRequestException(`Supplier ${supplierId} does not belong to this company`);
    }

    const isActive = await this.purchaseOrdersRepository.findSupplierActive(supplierId);
    if (!isActive) {
      throw new BadRequestException(
        `Supplier ${supplierId} is inactive — cannot create or assign purchase orders`,
      );
    }
  }
}
