import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { InvoiceStatus } from './common/enums/invoice-status.enum';
import { InvoiceType } from './common/enums/invoice-type.enum';
import { PaymentTermsType } from './common/enums/payment-terms-type.enum';
import { CreateInvoiceLineDto } from './dto/create-invoice-line.dto';
import { UpdateInvoiceLineDto } from './dto/update-invoice-line.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { InvoiceLine } from './entities/invoice-line.entity';
import { InvoiceWithLines } from './entities/invoice-with-lines.entity';
import { Invoice } from './entities/invoice.entity';
import { InsertInvoiceParams, InvoicesRepository } from './invoices.repository';

@Injectable()
export class SupabaseInvoicesRepository implements InvoicesRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async insertHeader(params: InsertInvoiceParams): Promise<Invoice> {
    const { data, error } = await this.supabase.client
      .from('invoices')
      .insert({
        company_id: params.company_id,
        customer_id: params.customer_id,
        invoice_date: params.invoice_date,
        payment_terms: params.payment_terms ?? PaymentTermsType.Net30,
        custom_days: params.custom_days ?? null,
        created_by: params.created_by,
        status: InvoiceStatus.Draft,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as Invoice;
  }

  async findAll(companyId: string): Promise<Invoice[]> {
    const { data, error } = await this.supabase.client
      .from('invoices')
      .select('*')
      .eq('company_id', companyId)
      .order('invoice_date', { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []) as Invoice[];
  }

  async findByIdWithLines(id: string): Promise<InvoiceWithLines | null> {
    const { data: invoice, error: invoiceError } = await this.supabase.client
      .from('invoices')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (invoiceError) {
      throw invoiceError;
    }
    if (!invoice) {
      return null;
    }

    const { data: lines, error: linesError } = await this.supabase.client
      .from('invoice_lines')
      .select('*')
      .eq('invoice_id', id)
      .order('line_number');

    if (linesError) {
      throw linesError;
    }

    return {
      invoice: invoice as Invoice,
      lines: (lines ?? []) as InvoiceLine[],
    };
  }

  async updateHeader(id: string, patch: UpdateInvoiceDto): Promise<Invoice> {
    const { data, error } = await this.supabase.client
      .from('invoices')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as Invoice;
  }

  async updateStatus(
    id: string,
    status: InvoiceStatus,
    voidReason?: string,
  ): Promise<Invoice> {
    const patch: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (voidReason !== undefined) {
      patch.void_reason = voidReason;
    }

    const { data, error } = await this.supabase.client
      .from('invoices')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as Invoice;
  }

  async deleteHeader(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('invoices').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }

  async insertLine(invoiceId: string, dto: CreateInvoiceLineDto): Promise<InvoiceLine> {
    const { data, error } = await this.supabase.client
      .from('invoice_lines')
      .insert({
        invoice_id: invoiceId,
        line_number: dto.line_number,
        description: dto.description,
        quantity: dto.quantity,
        unit_price: dto.unit_price,
        discount_percent: dto.discount_percent ?? null,
        discount_amount: dto.discount_amount ?? null,
        vat_rate: dto.vat_rate,
        is_service: dto.is_service ?? false,
        income_account_id: dto.income_account_id ?? null,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as InvoiceLine;
  }

  async updateLine(id: string, dto: UpdateInvoiceLineDto): Promise<InvoiceLine> {
    const { data, error } = await this.supabase.client
      .from('invoice_lines')
      .update(dto)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as InvoiceLine;
  }

  async deleteLine(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('invoice_lines').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }

  async findInvoiceIdByLineId(lineId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('invoice_lines')
      .select('invoice_id')
      .eq('id', lineId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data?.invoice_id as string | undefined) ?? null;
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

  async issueInvoice(id: string, invoiceTypeOverride?: InvoiceType | null): Promise<Invoice> {
    const { data, error } = await this.supabase.client.rpc('issue_invoice', {
      p_invoice_id: id,
      p_invoice_type_override: invoiceTypeOverride ?? null,
    });

    if (error) {
      throw error;
    }

    return data as Invoice;
  }

  async voidInvoice(
    id: string,
    voidReason: string,
    createdBy: string,
  ): Promise<{
    invoice: Invoice;
    ledger_reversal_status: 'reversed' | 'skipped_no_posting';
  }> {
    const { data, error } = await this.supabase.client.rpc('void_invoice', {
      p_invoice_id: id,
      p_void_reason: voidReason,
      p_created_by: createdBy,
    });

    if (error) {
      throw error;
    }

    const result = data as {
      invoice: Invoice;
      ledger_reversal_status: 'reversed' | 'skipped_no_posting';
    };

    return {
      invoice: result.invoice,
      ledger_reversal_status: result.ledger_reversal_status,
    };
  }

  async markOverdueInvoices(companyId: string): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('mark_overdue_invoices', {
      p_company_id: companyId,
    });

    if (error) {
      throw error;
    }

    return data as number;
  }

  async listCompanyIdsWithOpenInvoices(): Promise<string[]> {
    const { data, error } = await this.supabase.client
      .from('invoices')
      .select('company_id')
      .in('status', ['issued', 'sent', 'viewed']);

    if (error) {
      throw error;
    }

    const ids = new Set<string>();
    for (const row of data ?? []) {
      ids.add(row.company_id as string);
    }
    return [...ids];
  }

  async writeOffInvoice(
    id: string,
    createdBy: string,
    reason: string,
    debtorNotifiedAt: string | null,
  ): Promise<{ journal_entry_id: string }> {
    const { data, error } = await this.supabase.client.rpc('create_invoice_write_off', {
      p_invoice_id: id,
      p_created_by: createdBy,
      p_reason: reason,
      p_debtor_notified_at: debtorNotifiedAt,
    });

    if (error) {
      throw error;
    }

    const result = data as { journal_entry_id: string };
    return { journal_entry_id: result.journal_entry_id };
  }
}
