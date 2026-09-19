import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { CtRepository } from './ct.repository';

@Injectable()
export class SupabaseCtRepository implements CtRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.supabase.client.rpc(fn, args);
    if (error) {
      throw error;
    }
    return data as T;
  }

  async listProvisions(companyId: string, fiscalYear?: number): Promise<unknown[]> {
    let query = this.supabase.client
      .from('ct_provision_entries')
      .select('*')
      .eq('company_id', companyId)
      .order('fiscal_year', { ascending: false });
    if (fiscalYear !== undefined) {
      query = query.eq('fiscal_year', fiscalYear);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  async listRelatedParty(companyId: string): Promise<unknown[]> {
    const { data, error } = await this.supabase.client
      .from('related_party_transactions')
      .select('*')
      .eq('company_id', companyId)
      .order('transaction_date', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async insertIncomeAdjustment(row: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data, error } = await this.supabase.client
      .from('ct_income_adjustments')
      .insert(row)
      .select('*')
      .single();
    if (error) throw error;
    return data as Record<string, unknown>;
  }

  async getRegistrationStatus(companyId: string): Promise<{ trn: string | null } | null> {
    const { data, error } = await this.supabase.client
      .from('companies')
      .select('trn')
      .eq('id', companyId)
      .maybeSingle();
    if (error) throw error;
    return data as { trn: string | null } | null;
  }
}
