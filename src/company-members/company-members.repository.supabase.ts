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
}
