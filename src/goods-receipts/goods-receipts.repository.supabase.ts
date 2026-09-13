import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { CreateGoodsReceiptLineDto } from './dto/create-goods-receipt-line.dto';
import { UpdateGoodsReceiptLineDto } from './dto/update-goods-receipt-line.dto';
import { UpdateGoodsReceiptDto } from './dto/update-goods-receipt.dto';
import { GoodsReceiptLine } from './entities/goods-receipt-line.entity';
import { GoodsReceiptWithLines } from './entities/goods-receipt-with-lines.entity';
import { GoodsReceipt } from './entities/goods-receipt.entity';
import {
  GoodsReceiptsRepository,
  InsertGoodsReceiptParams,
} from './goods-receipts.repository';

@Injectable()
export class SupabaseGoodsReceiptsRepository implements GoodsReceiptsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async insertHeader(params: InsertGoodsReceiptParams): Promise<GoodsReceipt> {
    const { data, error } = await this.supabase.client
      .from('goods_receipts')
      .insert({
        company_id: params.company_id,
        supplier_id: params.supplier_id,
        purchase_order_id: params.purchase_order_id,
        receipt_date: params.receipt_date,
        created_by: params.created_by,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as GoodsReceipt;
  }

  async findAll(companyId: string): Promise<GoodsReceipt[]> {
    const { data, error } = await this.supabase.client
      .from('goods_receipts')
      .select('*')
      .eq('company_id', companyId)
      .order('receipt_date', { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []) as GoodsReceipt[];
  }

  async findByIdWithLines(id: string): Promise<GoodsReceiptWithLines | null> {
    const { data: goodsReceipt, error: headerError } = await this.supabase.client
      .from('goods_receipts')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (headerError) {
      throw headerError;
    }
    if (!goodsReceipt) {
      return null;
    }

    const { data: lines, error: linesError } = await this.supabase.client
      .from('goods_receipt_lines')
      .select('*')
      .eq('goods_receipt_id', id);

    if (linesError) {
      throw linesError;
    }

    return {
      goods_receipt: goodsReceipt as GoodsReceipt,
      lines: (lines ?? []) as GoodsReceiptLine[],
    };
  }

  async updateHeader(id: string, patch: UpdateGoodsReceiptDto): Promise<GoodsReceipt> {
    const { data, error } = await this.supabase.client
      .from('goods_receipts')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as GoodsReceipt;
  }

  async deleteHeader(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('goods_receipts').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }

  async insertLine(
    goodsReceiptId: string,
    dto: CreateGoodsReceiptLineDto,
  ): Promise<GoodsReceiptLine> {
    const { data, error } = await this.supabase.client
      .from('goods_receipt_lines')
      .insert({
        goods_receipt_id: goodsReceiptId,
        purchase_order_line_id: dto.purchase_order_line_id,
        quantity_received: dto.quantity_received,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as GoodsReceiptLine;
  }

  async updateLine(id: string, dto: UpdateGoodsReceiptLineDto): Promise<GoodsReceiptLine> {
    const { data, error } = await this.supabase.client
      .from('goods_receipt_lines')
      .update(dto)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as GoodsReceiptLine;
  }

  async deleteLine(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('goods_receipt_lines').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }

  async findLineById(lineId: string): Promise<GoodsReceiptLine | null> {
    const { data, error } = await this.supabase.client
      .from('goods_receipt_lines')
      .select('*')
      .eq('id', lineId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data as GoodsReceiptLine | null) ?? null;
  }

  async findPurchaseOrderCompanyId(poId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('purchase_orders')
      .select('company_id')
      .eq('id', poId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    return (data?.company_id as string | undefined) ?? null;
  }
}
