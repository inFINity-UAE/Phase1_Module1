import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { PublicHolidayStatus } from './common/enums/public-holiday-status.enum';
import { PublicHoliday } from './entities/public-holiday.entity';
import { PublicHolidaysRepository } from './public-holidays.repository';

@Injectable()
export class SupabasePublicHolidaysRepository implements PublicHolidaysRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async findAllForCompany(companyId: string): Promise<PublicHoliday[]> {
    const { data, error } = await this.supabase.client
      .from('public_holidays')
      .select('*')
      .or(`company_id.eq.${companyId},company_id.is.null`)
      .order('holiday_date', { ascending: true });

    if (error) {
      throw error;
    }
    return (data ?? []) as PublicHoliday[];
  }

  async findById(id: string): Promise<PublicHoliday | null> {
    const { data, error } = await this.supabase.client
      .from('public_holidays')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw error;
    }
    return (data as PublicHoliday | null) ?? null;
  }

  async insert(row: {
    company_id: string;
    holiday_date: string;
    description: string;
    source: string | null;
  }): Promise<PublicHoliday> {
    const { data, error } = await this.supabase.client
      .from('public_holidays')
      .insert({
        company_id: row.company_id,
        holiday_date: row.holiday_date,
        description: row.description,
        source: row.source,
        status: PublicHolidayStatus.Provisional,
      })
      .select('*')
      .single();

    if (error) {
      throw error;
    }
    return data as PublicHoliday;
  }

  async updateDateAndConfirm(id: string, holidayDate: string): Promise<PublicHoliday> {
    const { data, error } = await this.supabase.client
      .from('public_holidays')
      .update({
        holiday_date: holidayDate,
        status: PublicHolidayStatus.Confirmed,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw error;
    }
    return data as PublicHoliday;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('public_holidays').delete().eq('id', id);

    if (error) {
      throw error;
    }
  }
}
