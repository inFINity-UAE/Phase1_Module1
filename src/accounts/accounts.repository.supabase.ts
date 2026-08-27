import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { Account } from './entities/account.entity';
import { AccountsRepository, UpdateAccountRecord } from './accounts.repository';

@Injectable()
export class SupabaseAccountsRepository implements AccountsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async insert(dto: CreateAccountDto): Promise<Account> {
    // [feature-spec.md §7.16 finding #2 / decision #42] System flags are never
    // taken from the client DTO — seed/locking paths set them explicitly.
    const row: Record<string, unknown> = {
      company_id: dto.company_id,
      account_number: dto.account_number,
      account_name: dto.account_name,
      category: dto.category,
      sub_category: dto.sub_category ?? null,
      normal_balance: dto.normal_balance,
      parent_account_id: dto.parent_account_id ?? null,
      is_system_account: false,
      is_active: dto.is_active ?? true,
      locked_at: null,
      locked_reason: null,
      description: dto.description ?? null,
    };

    // [schema.sql] depth defaults to 1; DB triggers derive depth from parent when present
    if (dto.depth !== undefined) {
      row.depth = dto.depth;
    } else if (!dto.parent_account_id) {
      row.depth = 1;
    }

    const { data, error } = await this.supabase.client
      .from('accounts')
      .insert(row)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as Account;
  }

  async findAll(companyId?: string): Promise<Account[]> {
    let query = this.supabase.client.from('accounts').select('*');

    if (companyId) {
      query = query.eq('company_id', companyId);
    }

    const { data, error } = await query.order('account_number');

    if (error) {
      throw error;
    }

    return (data ?? []) as Account[];
  }

  async findById(id: string): Promise<Account | null> {
    const { data, error } = await this.supabase.client
      .from('accounts')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as Account | null;
  }

  async update(id: string, patch: UpdateAccountRecord): Promise<Account> {
    const { data, error } = await this.supabase.client
      .from('accounts')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as Account;
  }

  async updateActive(id: string, isActive: boolean): Promise<Account> {
    const { data, error } = await this.supabase.client
      .from('accounts')
      .update({ is_active: isActive })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as Account;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('accounts')
      .delete()
      .eq('id', id);

    if (error) {
      throw error;
    }
  }
}
