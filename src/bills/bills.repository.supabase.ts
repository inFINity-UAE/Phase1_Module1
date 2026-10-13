import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { PaymentTermsType } from '../invoices/common/enums/payment-terms-type.enum';
import { BillStatus } from './common/enums/bill-status.enum';
import { CreateBillLineDto } from './dto/create-bill-line.dto';
import { UpdateBillLineDto } from './dto/update-bill-line.dto';
import { BillLine } from './entities/bill-line.entity';
import { BillWithLines } from './entities/bill-with-lines.entity';
import { Bill } from './entities/bill.entity';
import {
  BillHeaderPatch,
  BillsRepository,
  InsertBillParams,
} from './bills.repository';

@Injectable()
export class SupabaseBillsRepository implements BillsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async insertHeader(params: InsertBillParams): Promise<Bill> {
    const { data, error } = await this.supabase.client
      .from('bills')
      .insert({
        company_id: params.company_id,
        supplier_id: params.supplier_id,
        supplier_invoice_number: params.supplier_invoice_number ?? null,
        purchase_order_id: params.purchase_order_id ?? null,
        bill_date: params.bill_date,
        payment_terms: params.payment_terms ?? PaymentTermsType.Net30,
        custom_days: params.custom_days ?? null,
        created_by: params.created_by,
        status: BillStatus.Draft,
      })
      .select()
      .single();

    if (error) throw error;

    return data as Bill;
  }

  async findAll(companyId: string, status?: BillStatus): Promise<Bill[]> {
    let query = this.supabase.client
      .from('bills')
      .select('*')
      .eq('company_id', companyId)
      .order('bill_date', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data ?? []) as Bill[];
  }

  async findByIdWithLines(id: string): Promise<BillWithLines | null> {
    const { data: bill, error: billError } = await this.supabase.client
      .from('bills')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (billError) throw billError;
    if (!bill) return null;

    const { data: lines, error: linesError } = await this.supabase.client
      .from('bill_lines')
      .select('*')
      .eq('bill_id', id)
      .order('line_number');

    if (linesError) throw linesError;

    return {
      bill: bill as Bill,
      lines: (lines ?? []) as BillLine[],
    };
  }

  async updateHeader(id: string, patch: BillHeaderPatch): Promise<Bill> {
    const { data, error } = await this.supabase.client
      .from('bills')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return data as Bill;
  }

  async deleteHeader(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('bills').delete().eq('id', id);
    if (error) throw error;
  }

  async insertLine(billId: string, dto: CreateBillLineDto): Promise<BillLine> {
    const { data, error } = await this.supabase.client
      .from('bill_lines')
      .insert({
        bill_id: billId,
        line_number: dto.line_number,
        purchase_order_line_id: dto.purchase_order_line_id ?? null,
        description: dto.description,
        quantity: dto.quantity,
        unit_price: dto.unit_price,
        discount_percent: dto.discount_percent ?? null,
        discount_amount: dto.discount_amount ?? null,
        vat_rate: dto.vat_rate,
        account_id: dto.account_id ?? null,
        vat_category: dto.vat_category ?? null,
        vat_input_treatment: dto.vat_input_treatment ?? null,
        capital_goods_project_id: dto.capital_goods_project_id ?? null,
      })
      .select()
      .single();

    if (error) throw error;

    return data as BillLine;
  }

  async updateLine(id: string, dto: UpdateBillLineDto): Promise<BillLine> {
    const { data, error } = await this.supabase.client
      .from('bill_lines')
      .update(dto)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return data as BillLine;
  }

  async deleteLine(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('bill_lines').delete().eq('id', id);
    if (error) throw error;
  }

  async findLineById(lineId: string): Promise<BillLine | null> {
    const { data, error } = await this.supabase.client
      .from('bill_lines')
      .select('*')
      .eq('id', lineId)
      .maybeSingle();

    if (error) throw error;

    return data as BillLine | null;
  }

  async findSupplierActive(supplierId: string): Promise<boolean | null> {
    const { data, error } = await this.supabase.client
      .from('suppliers')
      .select('is_active')
      .eq('id', supplierId)
      .maybeSingle();

    if (error) throw error;

    if (!data) return null;

    return Boolean(data.is_active);
  }

  async findSupplierCompanyId(supplierId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('suppliers')
      .select('company_id')
      .eq('id', supplierId)
      .maybeSingle();

    if (error) throw error;

    return (data?.company_id as string | undefined) ?? null;
  }

  async runThreeWayMatch(billId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('run_three_way_match', {
      p_bill_id: billId,
    });

    if (error) throw error;
  }

  async issueBill(billId: string, createdBy: string, immediatePost: boolean): Promise<Bill> {
    const { data, error } = await this.supabase.client.rpc('issue_bill', {
      p_bill_id: billId,
      p_created_by: createdBy,
      p_immediate_post: immediatePost,
    });

    if (error) throw error;

    return data as Bill;
  }

  async voidBill(
    billId: string,
    voidReason: string,
    createdBy: string,
  ): Promise<{
    bill: Bill;
    ledger_reversal_status: 'reversed' | 'skipped_no_posting';
  }> {
    const { data, error } = await this.supabase.client.rpc('void_bill', {
      p_bill_id: billId,
      p_void_reason: voidReason,
      p_created_by: createdBy,
    });

    if (error) throw error;

    const result = data as {
      bill: Bill;
      ledger_reversal_status: 'reversed' | 'skipped_no_posting';
    };

    return {
      bill: result.bill,
      ledger_reversal_status: result.ledger_reversal_status,
    };
  }
}
