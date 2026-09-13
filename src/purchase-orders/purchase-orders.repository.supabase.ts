import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { PoStatus } from './common/enums/po-status.enum';
import { CreatePurchaseOrderLineDto } from './dto/create-purchase-order-line.dto';
import { UpdatePurchaseOrderLineDto } from './dto/update-purchase-order-line.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';
import { PurchaseOrderWithLines } from './entities/purchase-order-with-lines.entity';
import { PurchaseOrder } from './entities/purchase-order.entity';
import {
  InsertPurchaseOrderParams,
  PurchaseOrdersRepository,
} from './purchase-orders.repository';

@Injectable()
export class SupabasePurchaseOrdersRepository implements PurchaseOrdersRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async insertHeader(params: InsertPurchaseOrderParams): Promise<PurchaseOrder> {
    const { data, error } = await this.supabase.client
      .from('purchase_orders')
      .insert({
        company_id: params.company_id,
        supplier_id: params.supplier_id,
        po_date: params.po_date,
        created_by: params.created_by,
        status: PoStatus.Open,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as PurchaseOrder;
  }

  async findAll(companyId: string): Promise<PurchaseOrder[]> {
    const { data, error } = await this.supabase.client
      .from('purchase_orders')
      .select('*')
      .eq('company_id', companyId)
      .order('po_date', { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []) as PurchaseOrder[];
  }

  async findByIdWithLines(id: string): Promise<PurchaseOrderWithLines | null> {
    const { data: purchaseOrder, error: headerError } = await this.supabase.client
      .from('purchase_orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (headerError) {
      throw headerError;
    }
    if (!purchaseOrder) {
      return null;
    }

    const { data: lines, error: linesError } = await this.supabase.client
      .from('purchase_order_lines')
      .select('*')
      .eq('po_id', id)
      .order('line_number');

    if (linesError) {
      throw linesError;
    }

    return {
      purchase_order: purchaseOrder as PurchaseOrder,
      lines: (lines ?? []) as PurchaseOrderLine[],
    };
  }

  async updateHeader(id: string, patch: UpdatePurchaseOrderDto): Promise<PurchaseOrder> {
    const { data, error } = await this.supabase.client
      .from('purchase_orders')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as PurchaseOrder;
  }

  async deleteHeader(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('purchase_orders').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }

  async insertLine(poId: string, dto: CreatePurchaseOrderLineDto): Promise<PurchaseOrderLine> {
    const { data, error } = await this.supabase.client
      .from('purchase_order_lines')
      .insert({
        po_id: poId,
        line_number: dto.line_number,
        description: dto.description,
        quantity: dto.quantity,
        unit_price: dto.unit_price,
        account_id: dto.account_id,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as PurchaseOrderLine;
  }

  async updateLine(id: string, dto: UpdatePurchaseOrderLineDto): Promise<PurchaseOrderLine> {
    const { data, error } = await this.supabase.client
      .from('purchase_order_lines')
      .update(dto)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as PurchaseOrderLine;
  }

  async deleteLine(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('purchase_order_lines').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }

  async findLineById(lineId: string): Promise<PurchaseOrderLine | null> {
    const { data, error } = await this.supabase.client
      .from('purchase_order_lines')
      .select('*')
      .eq('id', lineId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data as PurchaseOrderLine | null) ?? null;
  }

  async findSupplierActive(supplierId: string): Promise<boolean | null> {
    const { data, error } = await this.supabase.client
      .from('suppliers')
      .select('is_active')
      .eq('id', supplierId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    return Boolean(data.is_active);
  }

  async findSupplierCompanyId(supplierId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('suppliers')
      .select('company_id')
      .eq('id', supplierId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    return (data?.company_id as string | undefined) ?? null;
  }
}
