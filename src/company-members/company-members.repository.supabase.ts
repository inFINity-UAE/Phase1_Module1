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
}
