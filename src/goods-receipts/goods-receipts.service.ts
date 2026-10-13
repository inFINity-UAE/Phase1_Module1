import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { handleDatabaseError } from '../common/errors/database-error.mapper';
import { CreateGoodsReceiptLineDto } from './dto/create-goods-receipt-line.dto';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { UpdateGoodsReceiptLineDto } from './dto/update-goods-receipt-line.dto';
import { UpdateGoodsReceiptDto } from './dto/update-goods-receipt.dto';
import { GoodsReceiptLine } from './entities/goods-receipt-line.entity';
import { GoodsReceiptWithLines } from './entities/goods-receipt-with-lines.entity';
import { GoodsReceipt } from './entities/goods-receipt.entity';
import {
  GOODS_RECEIPTS_REPOSITORY,
  GoodsReceiptsRepository,
} from './goods-receipts.repository';

@Injectable()
export class GoodsReceiptsService {
  constructor(
    @Inject(GOODS_RECEIPTS_REPOSITORY)
    private readonly goodsReceiptsRepository: GoodsReceiptsRepository,
  ) {}

  async create(dto: CreateGoodsReceiptDto, createdBy: string): Promise<GoodsReceiptWithLines> {
    await this.assertPurchaseOrderUsable(dto.purchase_order_id, dto.company_id);

    try {
      const header = await this.goodsReceiptsRepository.insertHeader({
        ...dto,
        created_by: createdBy,
      });

      for (const line of dto.lines ?? []) {
        await this.goodsReceiptsRepository.insertLine(header.id, line);
      }

      return this.findOne(header.id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findAll(companyId: string): Promise<GoodsReceipt[]> {
    try {
      return await this.goodsReceiptsRepository.findAll(companyId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findOne(id: string): Promise<GoodsReceiptWithLines> {
    try {
      const result = await this.goodsReceiptsRepository.findByIdWithLines(id);
      if (!result) throw new NotFoundException(`Goods receipt ${id} not found`);
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      handleDatabaseError(error);
    }
  }

  /** [feature-spec-1_1_E.md §3.6] GRNs do not post — no issued/posted lock. */
  async update(id: string, dto: UpdateGoodsReceiptDto): Promise<GoodsReceiptWithLines> {
    const current = await this.findOne(id);

    if (dto.purchase_order_id && dto.purchase_order_id !== current.goods_receipt.purchase_order_id) {
      await this.assertPurchaseOrderUsable(dto.purchase_order_id, current.goods_receipt.company_id);
    }

    const hasPatch =
      dto.supplier_id !== undefined ||
      dto.purchase_order_id !== undefined ||
      dto.receipt_date !== undefined;
    if (!hasPatch) throw new BadRequestException('No updatable fields provided');

    try {
      await this.goodsReceiptsRepository.updateHeader(id, dto);
      return this.findOne(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    try {
      await this.goodsReceiptsRepository.deleteHeader(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async createLine(grnId: string, dto: CreateGoodsReceiptLineDto): Promise<GoodsReceiptLine> {
    await this.findOne(grnId);

    try {
      return await this.goodsReceiptsRepository.insertLine(grnId, dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async updateLine(
    grnId: string,
    lineId: string,
    dto: UpdateGoodsReceiptLineDto,
  ): Promise<GoodsReceiptLine> {
    await this.findOne(grnId);
    await this.requireLineOnParent(grnId, lineId);

    try {
      return await this.goodsReceiptsRepository.updateLine(lineId, dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async deleteLine(grnId: string, lineId: string): Promise<void> {
    await this.findOne(grnId);
    await this.requireLineOnParent(grnId, lineId);

    try {
      await this.goodsReceiptsRepository.deleteLine(lineId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  private async requireLineOnParent(grnId: string, lineId: string): Promise<GoodsReceiptLine> {
    const line = await this.goodsReceiptsRepository.findLineById(lineId);
    if (!line || line.goods_receipt_id !== grnId) {
      throw new NotFoundException(`Goods receipt line ${lineId} not found on goods receipt ${grnId}`);
    }
    return line;
  }

  private async assertPurchaseOrderUsable(poId: string, companyId: string): Promise<void> {
    const poCompanyId = await this.goodsReceiptsRepository.findPurchaseOrderCompanyId(poId);
    if (!poCompanyId) throw new NotFoundException(`Purchase order ${poId} not found`);
    if (poCompanyId !== companyId) {
      throw new BadRequestException(`Purchase order ${poId} does not belong to this company`);
    }
  }
}
