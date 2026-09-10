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
   * [feature-spec.md decision #30 / #38] Overlap = period_start < candidateEnd AND
   * period_end > candidateStart. DB backstop: accounting_periods_company_daterange_excl
   * (half-open daterange). This query remains the normal-path check for a clean 409.
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
   * ponytail: no Rules §1.22 close checklist. Ceiling: soft-close always succeeds.
   * Upgrade: require checklist (or override reason) before the status change.
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

  async listPeriodsPendingEcl(): Promise<
    Array<{ company_id: string; period_end: string }>
  > {
    const { data: periods, error: periodsError } = await this.supabase.client
      .from('accounting_periods')
      .select('company_id, period_end')
      .neq('status', PeriodStatus.Closed);

    if (periodsError) {
      throw periodsError;
    }

    const { data: runs, error: runsError } = await this.supabase.client
      .from('ecl_provision_runs')
      .select('company_id, period_end_date');

    if (runsError) {
      throw runsError;
    }

    const done = new Set(
      (runs ?? []).map(
        (r) => `${r.company_id as string}|${r.period_end_date as string}`,
      ),
    );

    const pending: Array<{ company_id: string; period_end: string }> = [];
    for (const row of periods ?? []) {
      const companyId = row.company_id as string;
      const periodEnd = row.period_end as string;
      if (!done.has(`${companyId}|${periodEnd}`)) {
        pending.push({ company_id: companyId, period_end: periodEnd });
      }
    }
    return pending;
  }

  async addBusinessDays(
    companyId: string,
    startDate: string,
    n: number,
  ): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('add_business_days', {
      p_company_id: companyId,
      p_start_date: startDate,
      p_n: n,
    });

    if (error) {
      throw error;
    }

    return data as string;
  }

  async runEclProvision(
    companyId: string,
    periodEndDate: string,
    createdBy: string,
  ): Promise<{ journal_entry_id: string | null }> {
    const { data, error } = await this.supabase.client.rpc('run_ecl_provision', {
      p_company_id: companyId,
      p_period_end_date: periodEndDate,
      p_created_by: createdBy,
    });

    if (error) {
      throw error;
    }

    const result = data as { journal_entry_id?: string | null };
    return { journal_entry_id: result.journal_entry_id ?? null };
  }
}
