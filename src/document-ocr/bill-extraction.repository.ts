import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { ExtractionSnapshot } from './extraction-rules';

export interface ExtractionRow {
  id: string;
  company_id: string;
  bill_id: string | null;
  source_file_name: string;
  source_file_url: string;
  source_file_size_bytes: number | null;
  source_mime_type: string | null;
  veryfi_document_id: string;
  extracted_snapshot: ExtractionSnapshot;
  field_origin: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface ExistingBillForDuplicate {
  supplierId: string;
  supplierInvoiceNumber: string | null;
  grandTotal: number;
  billDate: string;
  voided: boolean;
}

@Injectable()
export class BillExtractionRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async insert(row: {
    companyId: string;
    fileName: string;
    fileUrl: string;
    fileSize: number | null;
    mimeType: string | null;
    veryfiDocumentId: string;
    snapshot: ExtractionSnapshot;
    fieldOrigin: Record<string, string>;
  }): Promise<ExtractionRow> {
    const { data, error } = await this.supabase.client
      .from('bill_extraction_meta')
      .insert({
        company_id: row.companyId,
        source_file_name: row.fileName,
        source_file_url: row.fileUrl,
        source_file_size_bytes: row.fileSize,
        source_mime_type: row.mimeType,
        veryfi_document_id: row.veryfiDocumentId,
        extracted_snapshot: row.snapshot,
        field_origin: row.fieldOrigin,
      })
      .select()
      .single();
    if (error) throw error;
    return data as ExtractionRow;
  }

  async findById(id: string): Promise<ExtractionRow | null> {
    const { data, error } = await this.supabase.client
      .from('bill_extraction_meta')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return (data as ExtractionRow | null) ?? null;
  }

  async findByVeryfiId(veryfiDocumentId: string): Promise<ExtractionRow | null> {
    const { data, error } = await this.supabase.client
      .from('bill_extraction_meta')
      .select('*')
      .eq('veryfi_document_id', veryfiDocumentId)
      .maybeSingle();
    if (error) throw error;
    return (data as ExtractionRow | null) ?? null;
  }

  async updateSnapshot(
    id: string,
    snapshot: ExtractionSnapshot,
    fieldOrigin: Record<string, string>,
    billId?: string | null,
  ): Promise<ExtractionRow> {
    const patch: Record<string, unknown> = {
      extracted_snapshot: snapshot,
      field_origin: fieldOrigin,
      updated_at: new Date().toISOString(),
    };
    if (billId !== undefined) patch.bill_id = billId;
    const { data, error } = await this.supabase.client
      .from('bill_extraction_meta')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as ExtractionRow;
  }

  async listForCompany(companyId: string): Promise<ExtractionRow[]> {
    const { data, error } = await this.supabase.client
      .from('bill_extraction_meta')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as ExtractionRow[];
  }

  async standardRate(billDate: string): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('effective_vat_standard_rate', {
      p_on_date: billDate,
    });
    if (error) throw error;
    return Number(data);
  }

  async billsForDuplicate(companyId: string): Promise<ExistingBillForDuplicate[]> {
    const { data, error } = await this.supabase.client
      .from('bills')
      .select('supplier_id, supplier_invoice_number, grand_total, bill_date, status')
      .eq('company_id', companyId);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      supplierId: row.supplier_id as string,
      supplierInvoiceNumber: (row.supplier_invoice_number as string | null) ?? null,
      grandTotal: Number(row.grand_total),
      billDate: row.bill_date as string,
      voided: row.status === 'void',
    }));
  }

  async learnedAccountId(companyId: string, supplierId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('bill_extraction_meta')
      .select('bill_id, extracted_snapshot')
      .eq('company_id', companyId)
      .not('bill_id', 'is', null);
    if (error) throw error;
    const billIds = (data ?? [])
      .filter((row) => {
        const snapshot = row.extracted_snapshot as ExtractionSnapshot;
        return snapshot?.review?.status === 'cleared';
      })
      .map((row) => row.bill_id as string);
    if (billIds.length === 0) return null;

    const bills = await this.supabase.client
      .from('bills')
      .select('id')
      .eq('supplier_id', supplierId)
      .in('id', billIds);
    if (bills.error) throw bills.error;
    const supplierBillIds = (bills.data ?? []).map((row) => row.id as string);
    if (supplierBillIds.length === 0) return null;

    const lines = await this.supabase.client
      .from('bill_lines')
      .select('account_id')
      .in('bill_id', supplierBillIds);
    if (lines.error) throw lines.error;
    const accounts = [...new Set((lines.data ?? []).map((row) => row.account_id as string | null))];
    if (accounts.length !== 1 || accounts[0] == null) return null;
    return accounts[0];
  }
}
