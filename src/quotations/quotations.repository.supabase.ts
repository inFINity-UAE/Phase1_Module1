import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { QuotationStatus } from './common/enums/quotation-status.enum';
import { CreateQuotationLineDto } from './dto/create-quotation-line.dto';
import { UpdateQuotationLineDto } from './dto/update-quotation-line.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { QuotationLine } from './entities/quotation-line.entity';
import { QuotationWithLines } from './entities/quotation-with-lines.entity';
import { Quotation } from './entities/quotation.entity';
import {
  InsertQuotationParams,
  QuotationsRepository,
} from './quotations.repository';

@Injectable()
export class SupabaseQuotationsRepository implements QuotationsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async insertHeader(params: InsertQuotationParams): Promise<Quotation> {
    const { data, error } = await this.supabase.client
      .from('quotations')
      .insert({
        company_id: params.company_id,
        customer_id: params.customer_id,
        quotation_date: params.quotation_date,
        valid_until: params.valid_until ?? null,
        notes: params.notes ?? null,
        created_by: params.created_by,
        status: QuotationStatus.Draft,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as Quotation;
  }

  async findAll(companyId: string): Promise<Quotation[]> {
    const { data, error } = await this.supabase.client
      .from('quotations')
      .select('*')
      .eq('company_id', companyId)
      .order('quotation_date', { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []) as Quotation[];
  }

  async findByIdWithLines(id: string): Promise<QuotationWithLines | null> {
    const { data: quotation, error: quotationError } = await this.supabase.client
      .from('quotations')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (quotationError) {
      throw quotationError;
    }
    if (!quotation) {
      return null;
    }

    const { data: lines, error: linesError } = await this.supabase.client
      .from('quotation_lines')
      .select('*')
      .eq('quotation_id', id)
      .order('line_number');

    if (linesError) {
      throw linesError;
    }

    return {
      quotation: quotation as Quotation,
      lines: (lines ?? []) as QuotationLine[],
    };
  }

  async updateHeader(id: string, patch: UpdateQuotationDto): Promise<Quotation> {
    const { data, error } = await this.supabase.client
      .from('quotations')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as Quotation;
  }

  async updateStatus(id: string, status: QuotationStatus): Promise<Quotation> {
    const { data, error } = await this.supabase.client
      .from('quotations')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as Quotation;
  }

  async deleteHeader(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('quotations').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }

  async insertLine(quotationId: string, dto: CreateQuotationLineDto): Promise<QuotationLine> {
    const { data, error } = await this.supabase.client
      .from('quotation_lines')
      .insert({
        quotation_id: quotationId,
        line_number: dto.line_number,
        description: dto.description,
        quantity: dto.quantity,
        unit_price: dto.unit_price,
        discount_percent: dto.discount_percent ?? null,
        discount_amount: dto.discount_amount ?? null,
        vat_rate: dto.vat_rate,
        is_service: dto.is_service ?? false,
        vat_category: dto.vat_category ?? null,
        emirate: dto.emirate ?? null,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as QuotationLine;
  }

  async updateLine(id: string, dto: UpdateQuotationLineDto): Promise<QuotationLine> {
    const { data, error } = await this.supabase.client
      .from('quotation_lines')
      .update(dto)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as QuotationLine;
  }

  async deleteLine(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('quotation_lines').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }

  async findQuotationIdByLineId(lineId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('quotation_lines')
      .select('quotation_id')
      .eq('id', lineId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data?.quotation_id as string | undefined) ?? null;
  }

  async findCustomerActive(customerId: string): Promise<boolean | null> {
    const { data, error } = await this.supabase.client
      .from('customers')
      .select('is_active')
      .eq('id', customerId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    return Boolean(data.is_active);
  }

  async findCustomerCompanyId(customerId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('customers')
      .select('company_id')
      .eq('id', customerId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    return (data?.company_id as string | undefined) ?? null;
  }

  async convertToInvoice(quotationId: string, createdBy: string): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('convert_quotation_to_invoice', {
      p_quotation_id: quotationId,
      p_created_by: createdBy,
    });

    if (error) {
      throw error;
    }

    return data as string;
  }

  async expireDueQuotations(companyId: string): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('expire_due_quotations', {
      p_company_id: companyId,
    });

    if (error) {
      throw error;
    }

    return data as number;
  }

  async listCompanyIdsWithOpenQuotations(): Promise<string[]> {
    const { data, error } = await this.supabase.client
      .from('quotations')
      .select('company_id')
      .in('status', ['draft', 'sent', 'viewed']);

    if (error) {
      throw error;
    }

    const ids = new Set<string>();
    for (const row of data ?? []) {
      ids.add(row.company_id as string);
    }
    return [...ids];
  }
}
