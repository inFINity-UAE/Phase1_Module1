import { Injectable } from '@nestjs/common';
import { PeriodStatus } from '../common/enums/period-status.enum';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { SupabaseService } from '../database/supabase.service';
import { AccountingPeriod } from './entities/accounting-period.entity';
import {
  AccountingPeriodsRepository,
  CreateAccountingPeriodRecord,
  UpdateAccountingPeriodRecord,
} from './accounting-periods.repository';

@Injectable()
export class SupabaseAccountingPeriodsRepository implements AccountingPeriodsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async findById(id: string): Promise<AccountingPeriod | null> {
    const { data, error } = await this.supabase.client
      .from('accounting_periods')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as AccountingPeriod | null;
  }

  async findByCompanyId(companyId: string): Promise<AccountingPeriod[]> {
    const { data, error } = await this.supabase.client
      .from('accounting_periods')
      .select('*')
      .eq('company_id', companyId)
      .order('period_start', { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []) as AccountingPeriod[];
  }

  async create(record: CreateAccountingPeriodRecord): Promise<AccountingPeriod> {
    const { data, error } = await this.supabase.client
      .from('accounting_periods')
      .insert({
        company_id: record.company_id,
        period_start: record.period_start,
        period_end: record.period_end,
        fiscal_year: record.fiscal_year,
        // status defaults to 'open' in schema.sql — do not set from client
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as AccountingPeriod;
  }

  async update(id: string, patch: UpdateAccountingPeriodRecord): Promise<AccountingPeriod> {
    const { data, error } = await this.supabase.client
      .from('accounting_periods')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as AccountingPeriod;
  }

  /**
   * [feature-spec.md decision #30] Overlap = period_start < candidateEnd AND
   * period_end > candidateStart. Schema only has unique(company_id, period_start,
   * period_end) — exact duplicates — not a GiST/exclusion overlap constraint.
   */
  async hasOverlappingPeriod(
    companyId: string,
    periodStart: string,
    periodEnd: string,
    excludePeriodId?: string,
  ): Promise<boolean> {
    let query = this.supabase.client
      .from('accounting_periods')
      .select('id')
      .eq('company_id', companyId)
      .lt('period_start', periodEnd)
      .gt('period_end', periodStart)
      .limit(1);

    if (excludePeriodId) {
      query = query.neq('id', excludePeriodId);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return (data?.length ?? 0) > 0;
  }

  async hasPostedJournalActivity(periodId: string): Promise<boolean> {
    const { data, error } = await this.supabase.client
      .from('journal_entries')
      .select('id')
      .eq('period_id', periodId)
      .eq('status', JournalEntryStatus.Posted)
      .limit(1);

    if (error) {
      throw error;
    }

    return (data?.length ?? 0) > 0;
  }

  /**
   * [feature-spec] Soft-close — blocks new postings unless Owner override with reason.
   * TODO: [Rules §1.22] Close checklist (bank recs, AR/AP reconciled, accruals posted,
   * depreciation run, etc.) must be complete before soft-close, or require explicit
   * override with reason. Not implemented in Module 1.1.A — build when checklist exists.
   */
  async softClose(id: string, closedBy: string): Promise<AccountingPeriod> {
    const now = new Date().toISOString();

    const { data, error } = await this.supabase.client
      .from('accounting_periods')
      .update({
        status: PeriodStatus.SoftClosed,
        soft_closed_by: closedBy,
        soft_closed_at: now,
      })
      .eq('id', id)
      .eq('status', PeriodStatus.Open)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as AccountingPeriod;
  }

  /** [Rules §1.3] Log prior-period adjustment override on accounting_periods.reopen_* columns. */
  async logSoftClosedPostingOverride(
    periodId: string,
    actorId: string,
    reason: string,
  ): Promise<AccountingPeriod> {
    const now = new Date().toISOString();

    const { data, error } = await this.supabase.client
      .from('accounting_periods')
      .update({
        reopened_by: actorId,
        reopened_at: now,
        reopen_reason: reason,
      })
      .eq('id', periodId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as AccountingPeriod;
  }
}
