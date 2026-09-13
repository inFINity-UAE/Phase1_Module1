import { Injectable } from '@nestjs/common';
import { CompanyRole } from '../common/enums/company-role.enum';
import { SupabaseService } from '../database/supabase.service';
import { CompanyMembersRepository } from './company-members.repository';

@Injectable()
export class SupabaseCompanyMembersRepository implements CompanyMembersRepository {
  constructor(private readonly supabase: SupabaseService) {}

  // [company_members.sql §11] Role lookup via service_role — never trust client body.
  async findRole(userId: string, companyId: string): Promise<CompanyRole | null> {
    const { data, error } = await this.supabase.client
      .from('company_members')
      .select('role')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data?.role as CompanyRole | undefined) ?? null;
  }

  async findOwnerUserId(companyId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('company_members')
      .select('user_id')
      .eq('company_id', companyId)
      .eq('role', CompanyRole.Owner)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data?.user_id as string | undefined) ?? null;
  }

  async findCompanyIdByJournalEntryId(entryId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('journal_entries')
      .select('company_id')
      .eq('id', entryId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data?.company_id as string | undefined) ?? null;
  }

  async findCompanyIdByJournalLineId(lineId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('journal_lines')
      .select('journal_entry_id, journal_entries!inner(company_id)')
      .eq('id', lineId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const parent = data?.journal_entries as { company_id?: string } | { company_id?: string }[] | null;
    if (!parent) {
      return null;
    }
    if (Array.isArray(parent)) {
      return parent[0]?.company_id ?? null;
    }
    return parent.company_id ?? null;
  }

  async findCompanyIdByAccountId(accountId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('accounts')
      .select('company_id')
      .eq('id', accountId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data?.company_id as string | undefined) ?? null;
  }

  async findCompanyIdByAccountingPeriodId(periodId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('accounting_periods')
      .select('company_id')
      .eq('id', periodId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data?.company_id as string | undefined) ?? null;
  }

  async findCompanyIdByRecurringTemplateId(templateId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('recurring_journal_templates')
      .select('company_id')
      .eq('id', templateId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data?.company_id as string | undefined) ?? null;
  }

  async findCompanyIdByRecurringTemplateLineId(lineId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('recurring_journal_template_lines')
      .select('template_id, recurring_journal_templates!inner(company_id)')
      .eq('id', lineId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const parent = data?.recurring_journal_templates as
      | { company_id?: string }
      | { company_id?: string }[]
      | null;
    if (!parent) {
      return null;
    }
    if (Array.isArray(parent)) {
      return parent[0]?.company_id ?? null;
    }
    return parent.company_id ?? null;
  }

  async findCompanyIdByCustomerId(customerId: string): Promise<string | null> {
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

  async findCompanyIdByQuotationId(quotationId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('quotations')
      .select('company_id')
      .eq('id', quotationId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data?.company_id as string | undefined) ?? null;
  }

  async findCompanyIdByQuotationLineId(lineId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('quotation_lines')
      .select('quotation_id, quotations!inner(company_id)')
      .eq('id', lineId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const parent = data?.quotations as { company_id?: string } | { company_id?: string }[] | null;
    if (!parent) {
      return null;
    }
    if (Array.isArray(parent)) {
      return parent[0]?.company_id ?? null;
    }
    return parent.company_id ?? null;
  }

  async findCompanyIdByInvoiceId(invoiceId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('invoices')
      .select('company_id')
      .eq('id', invoiceId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data?.company_id as string | undefined) ?? null;
  }

  async findCompanyIdByInvoiceLineId(lineId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('invoice_lines')
      .select('invoice_id, invoices!inner(company_id)')
      .eq('id', lineId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const parent = data?.invoices as { company_id?: string } | { company_id?: string }[] | null;
    if (!parent) {
      return null;
    }
    if (Array.isArray(parent)) {
      return parent[0]?.company_id ?? null;
    }
    return parent.company_id ?? null;
  }

  async findCompanyIdByCreditNoteId(creditNoteId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('credit_notes')
      .select('company_id')
      .eq('id', creditNoteId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data?.company_id as string | undefined) ?? null;
  }

  async findCompanyIdByCreditNoteLineId(lineId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('credit_note_lines')
      .select('credit_note_id, credit_notes!inner(company_id)')
      .eq('id', lineId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const parent = data?.credit_notes as { company_id?: string } | { company_id?: string }[] | null;
    if (!parent) {
      return null;
    }
    if (Array.isArray(parent)) {
      return parent[0]?.company_id ?? null;
    }
    return parent.company_id ?? null;
  }

  async findCompanyIdByPaymentId(paymentId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('payments')
      .select('company_id')
      .eq('id', paymentId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data?.company_id as string | undefined) ?? null;
  }

  async findCompanyIdByPaymentApplicationId(applicationId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('payment_applications')
      .select('payment_id, payments!inner(company_id)')
      .eq('id', applicationId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const parent = data?.payments as { company_id?: string } | { company_id?: string }[] | null;
    if (!parent) {
      return null;
    }
    if (Array.isArray(parent)) {
      return parent[0]?.company_id ?? null;
    }
    return parent.company_id ?? null;
  }

  async findCompanyIdByPublicHolidayId(holidayId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('public_holidays')
      .select('company_id')
      .eq('id', holidayId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    // UAE-wide rows (company_id null) are not tenant-resolvable — treat as missing.
    return (data?.company_id as string | undefined) ?? null;
  }

  async findCompanyIdBySupplierId(supplierId: string): Promise<string | null> {
    return this.findDirectCompanyId('suppliers', supplierId);
  }

  async findCompanyIdByPurchaseOrderId(poId: string): Promise<string | null> {
    return this.findDirectCompanyId('purchase_orders', poId);
  }

  async findCompanyIdByPurchaseOrderLineId(lineId: string): Promise<string | null> {
    return this.findNestedCompanyId(
      'purchase_order_lines',
      lineId,
      'po_id, purchase_orders!inner(company_id)',
      'purchase_orders',
    );
  }

  async findCompanyIdByGoodsReceiptId(grnId: string): Promise<string | null> {
    return this.findDirectCompanyId('goods_receipts', grnId);
  }

  async findCompanyIdByGoodsReceiptLineId(lineId: string): Promise<string | null> {
    return this.findNestedCompanyId(
      'goods_receipt_lines',
      lineId,
      'goods_receipt_id, goods_receipts!inner(company_id)',
      'goods_receipts',
    );
  }

  async findCompanyIdByBillId(billId: string): Promise<string | null> {
    return this.findDirectCompanyId('bills', billId);
  }

  async findCompanyIdByBillLineId(lineId: string): Promise<string | null> {
    return this.findNestedCompanyId(
      'bill_lines',
      lineId,
      'bill_id, bills!inner(company_id)',
      'bills',
    );
  }

  async findCompanyIdBySupplierPaymentId(paymentId: string): Promise<string | null> {
    return this.findDirectCompanyId('supplier_payments', paymentId);
  }

  async findCompanyIdBySupplierPaymentApplicationId(
    applicationId: string,
  ): Promise<string | null> {
    return this.findNestedCompanyId(
      'supplier_payment_applications',
      applicationId,
      'supplier_payment_id, supplier_payments!inner(company_id)',
      'supplier_payments',
    );
  }

  async findCompanyIdBySupplierPaymentRunId(runId: string): Promise<string | null> {
    return this.findDirectCompanyId('supplier_payment_runs', runId);
  }

  async findCompanyIdBySupplierStatementLineId(lineId: string): Promise<string | null> {
    return this.findDirectCompanyId('supplier_statement_lines', lineId);
  }

  private async findDirectCompanyId(
    table: string,
    id: string,
  ): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from(table)
      .select('company_id')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data?.company_id as string | undefined) ?? null;
  }

  private async findNestedCompanyId(
    table: string,
    id: string,
    select: string,
    parentKey: string,
  ): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from(table)
      .select(select)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const row = data as Record<string, unknown> | null;
    const parent = row?.[parentKey] as
      | { company_id?: string }
      | { company_id?: string }[]
      | null
      | undefined;
    if (!parent) {
      return null;
    }
    if (Array.isArray(parent)) {
      return parent[0]?.company_id ?? null;
    }
    return parent.company_id ?? null;
  }
}
