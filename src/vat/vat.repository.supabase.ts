import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { VatRepository } from './vat.repository';

@Injectable()
export class SupabaseVatRepository implements VatRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.supabase.client.rpc(fn, args);
    if (error) {
      throw error;
    }
    return data as T;
  }

  async listReturns(companyId: string): Promise<unknown[]> {
    const { data, error } = await this.supabase.client
      .from('vat_return_periods')
      .select('*')
      .eq('company_id', companyId)
      .order('period_start', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async findReturn(id: string): Promise<Record<string, unknown> | null> {
    return this.findById('vat_return_periods', id);
  }

  async listGroupSources(periodId: string, groupKey: string): Promise<unknown[]> {
    const { data: items, error: itemsError } = await this.supabase.client
      .from('vat_return_line_items')
      .select('id')
      .eq('period_id', periodId)
      .eq('group_key', groupKey);
    if (itemsError) throw itemsError;
    const ids = (items ?? []).map((row) => row.id as string);
    if (ids.length === 0) return [];
    const { data, error } = await this.supabase.client
      .from('vat_return_line_item_sources')
      .select('*')
      .in('line_item_id', ids);
    if (error) throw error;
    return data ?? [];
  }

  async listProjects(companyId: string): Promise<unknown[]> {
    return this.listByCompany('capital_goods_projects', companyId);
  }
  async findProject(id: string): Promise<Record<string, unknown> | null> {
    return this.findById('capital_goods_projects', id);
  }
  async insertProject(row: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.insert('capital_goods_projects', row);
  }
  async updateProject(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.update('capital_goods_projects', id, patch);
  }
  async deleteProject(id: string): Promise<void> {
    return this.remove('capital_goods_projects', id);
  }

  async listItems(companyId: string): Promise<unknown[]> {
    return this.listByCompany('capital_goods_items', companyId);
  }
  async findItem(id: string): Promise<Record<string, unknown> | null> {
    return this.findById('capital_goods_items', id);
  }
  async insertItem(row: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.insert('capital_goods_items', row);
  }
  async updateItem(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.update('capital_goods_items', id, patch);
  }
  async deleteItem(id: string): Promise<void> {
    return this.remove('capital_goods_items', id);
  }

  async listClaims(companyId: string): Promise<unknown[]> {
    return this.listByCompany('vat_bad_debt_relief_claims', companyId);
  }
  async findClaim(id: string): Promise<Record<string, unknown> | null> {
    return this.findById('vat_bad_debt_relief_claims', id);
  }
  async listDisclosures(companyId: string): Promise<unknown[]> {
    return this.listByCompany('vat_voluntary_disclosures', companyId);
  }
  async findDisclosure(id: string): Promise<Record<string, unknown> | null> {
    return this.findById('vat_voluntary_disclosures', id);
  }

  private async listByCompany(table: string, companyId: string): Promise<unknown[]> {
    const { data, error } = await this.supabase.client
      .from(table)
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  private async findById(table: string, id: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await this.supabase.client
      .from(table)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return (data as Record<string, unknown> | null) ?? null;
  }

  private async insert(table: string, row: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data, error } = await this.supabase.client.from(table).insert(row).select().single();
    if (error) throw error;
    return data as Record<string, unknown>;
  }

  private async update(
    table: string,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const { data, error } = await this.supabase.client
      .from(table)
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as Record<string, unknown>;
  }

  private async remove(table: string, id: string): Promise<void> {
    const { error } = await this.supabase.client.from(table).delete().eq('id', id);
    if (error) throw error;
  }
}
