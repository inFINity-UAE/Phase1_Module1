import { Injectable } from '@nestjs/common';
import { PeriodStatus } from '../common/enums/period-status.enum';
import { SupabaseService } from '../database/supabase.service';
import { AccountingPeriod } from './entities/accounting-period.entity';
import { AccountingPeriodsRepository } from './accounting-periods.repository';

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
