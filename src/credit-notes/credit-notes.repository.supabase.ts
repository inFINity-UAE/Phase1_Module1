import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { CreditNoteStatus } from './common/enums/credit-note-status.enum';
import { CreateCreditNoteLineDto } from './dto/create-credit-note-line.dto';
import { UpdateCreditNoteDto } from './dto/update-credit-note.dto';
import { UpdateCreditNoteLineDto } from './dto/update-credit-note-line.dto';
import { CreditNoteLine } from './entities/credit-note-line.entity';
import { CreditNoteWithLines } from './entities/credit-note-with-lines.entity';
import { CreditNote } from './entities/credit-note.entity';
import { CreditNotesRepository, InsertCreditNoteParams } from './credit-notes.repository';

@Injectable()
export class SupabaseCreditNotesRepository implements CreditNotesRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async insertHeader(params: InsertCreditNoteParams): Promise<CreditNote> {
    const invoice = await this.findInvoiceForCredit(params.original_invoice_id);
    if (!invoice) {
      throw new Error('INVOICE_NOT_FOUND');
    }

    const { data, error } = await this.supabase.client
      .from('credit_notes')
      .insert({
        company_id: invoice.company_id,
        customer_id: invoice.customer_id,
        original_invoice_id: params.original_invoice_id,
        credit_note_date: params.credit_note_date,
        created_by: params.created_by,
        status: CreditNoteStatus.Draft,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as CreditNote;
  }

  async findAll(companyId: string): Promise<CreditNote[]> {
    const { data, error } = await this.supabase.client
      .from('credit_notes')
      .select('*')
      .eq('company_id', companyId)
      .order('credit_note_date', { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []) as CreditNote[];
  }

  async findByIdWithLines(id: string): Promise<CreditNoteWithLines | null> {
    const { data: creditNote, error: headerError } = await this.supabase.client
      .from('credit_notes')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (headerError) {
      throw headerError;
    }
    if (!creditNote) {
      return null;
    }

    const { data: lines, error: linesError } = await this.supabase.client
      .from('credit_note_lines')
      .select('*')
      .eq('credit_note_id', id)
      .order('line_number');

    if (linesError) {
      throw linesError;
    }

    return {
      credit_note: creditNote as CreditNote,
      lines: (lines ?? []) as CreditNoteLine[],
    };
  }

  async updateHeader(id: string, patch: UpdateCreditNoteDto): Promise<CreditNote> {
    const { data, error } = await this.supabase.client
      .from('credit_notes')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as CreditNote;
  }

  async updateStatus(
    id: string,
    status: CreditNoteStatus,
    voidReason?: string,
  ): Promise<CreditNote> {
    const patch: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (voidReason !== undefined) {
      patch.void_reason = voidReason;
    }

    const { data, error } = await this.supabase.client
      .from('credit_notes')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as CreditNote;
  }

  async deleteHeader(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('credit_notes').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }

  async insertLine(creditNoteId: string, dto: CreateCreditNoteLineDto): Promise<CreditNoteLine> {
    const row: Record<string, unknown> = {
      credit_note_id: creditNoteId,
      line_number: dto.line_number,
      description: dto.description,
      quantity: dto.quantity,
      unit_price: dto.unit_price,
      discount_percent: dto.discount_percent ?? null,
      discount_amount: dto.discount_amount ?? null,
      original_invoice_line_id: dto.original_invoice_line_id ?? null,
      reason: dto.reason ?? null,
    };

    if (!dto.original_invoice_line_id) {
      row.vat_rate = dto.vat_rate;
      row.is_service = dto.is_service ?? false;
      row.income_account_id = dto.income_account_id ?? null;
    } else {
      row.vat_rate = 0;
    }

    const { data, error } = await this.supabase.client
      .from('credit_note_lines')
      .insert(row)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as CreditNoteLine;
  }

  async updateLine(id: string, dto: UpdateCreditNoteLineDto): Promise<CreditNoteLine> {
    const { data, error } = await this.supabase.client
      .from('credit_note_lines')
      .update(dto)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as CreditNoteLine;
  }

  async deleteLine(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('credit_note_lines').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }

  async findCreditNoteIdByLineId(lineId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('credit_note_lines')
      .select('credit_note_id')
      .eq('id', lineId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data?.credit_note_id as string | undefined) ?? null;
  }

  async findInvoiceForCredit(originalInvoiceId: string): Promise<{
    company_id: string;
    customer_id: string;
    status: string;
  } | null> {
    const { data, error } = await this.supabase.client
      .from('invoices')
      .select('company_id, customer_id, status')
      .eq('id', originalInvoiceId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }

    return data as { company_id: string; customer_id: string; status: string };
  }

  async issueCreditNote(id: string): Promise<CreditNote> {
    const { data, error } = await this.supabase.client.rpc('issue_credit_note', {
      p_credit_note_id: id,
    });

    if (error) {
      throw error;
    }

    return data as CreditNote;
  }
}
