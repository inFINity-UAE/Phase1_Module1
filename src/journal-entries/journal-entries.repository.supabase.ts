import { Injectable } from '@nestjs/common';
import { PeriodStatus } from '../common/enums/period-status.enum';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { SupabaseService } from '../database/supabase.service';
import { AccountingPeriod } from '../accounting-periods/entities/accounting-period.entity';
import { CompanySettings } from '../company-settings/entities/company-settings.entity';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';
import { CreateYearEndClosingDto } from './dto/create-year-end-closing.dto';
import { UpdateJournalLineDto } from './dto/update-journal-line.dto';
import { AccountCategory } from '../common/enums/account-category.enum';
import { NormalBalance } from '../common/enums/normal-balance.enum';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalLine } from './entities/journal-line.entity';
import { JournalAttachment } from './entities/journal-attachment.entity';
import { JournalEntryWithDetails } from './entities/journal-entry-with-details.entity';
import { JournalEntryReversalResult } from './entities/journal-entry-reversal-result.entity';
import { AccountTrialBalance } from './entities/account-trial-balance.entity';
import { TrialBalanceTotals } from './entities/trial-balance-totals.entity';
import { ProfitAndLossAccountBalance } from './entities/profit-and-loss-account-balance.entity';
import { computeAccountBalance } from './year-end-closing.util';
import {
  InsertGeneratedJournalEntryParams,
  CreateJournalEntryWithActor,
  CreateOpeningBalanceWithActor,
  CreateYearEndClosingWithActor,
  JournalEntriesRepository,
} from './journal-entries.repository';

@Injectable()
export class SupabaseJournalEntriesRepository implements JournalEntriesRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async getNextEntryNumber(companyId: string): Promise<number> {
    // [race fix] allocate_next_entry_number holds pg_advisory_xact_lock for this
    // company for the duration of the RPC transaction. Create paths must use
    // insert_journal_entry_draft (same transaction as the INSERT), not this
    // helper followed by a separate insert.
    const { data, error } = await this.supabase.client.rpc('allocate_next_entry_number', {
      p_company_id: companyId,
    });

    if (error) {
      throw error;
    }

    return Number(data);
  }

  async insertDraft(dto: CreateJournalEntryWithActor): Promise<JournalEntryWithDetails> {
    return this.insertJournalEntryDraftRpc({
      p_company_id: dto.company_id,
      p_period_id: dto.period_id,
      p_entry_date: dto.entry_date,
      p_entry_type: JournalEntryType.Manual,
      p_narration: dto.narration,
      p_created_by: dto.created_by,
      p_lines: dto.lines,
      p_reference_number: dto.reference_number ?? null,
      p_attachments: dto.attachments ?? [],
    });
  }

  private parseJournalPayload(data: unknown): JournalEntryWithDetails {
    const payload = data as {
      entry: JournalEntry;
      lines: JournalLine[];
      attachments?: JournalAttachment[];
    };

    return {
      entry: payload.entry,
      lines: payload.lines ?? [],
      attachments: payload.attachments ?? [],
    };
  }

  private async insertJournalEntryDraftRpc(params: {
    p_company_id: string;
    p_period_id: string;
    p_entry_date: string;
    p_entry_type: JournalEntryType;
    p_narration: string;
    p_created_by: string;
    p_lines: unknown;
    p_reference_number?: string | null;
    p_recurring_template_id?: string | null;
    p_attachments?: unknown;
  }): Promise<JournalEntryWithDetails> {
    const { data, error } = await this.supabase.client.rpc('insert_journal_entry_draft', {
      p_company_id: params.p_company_id,
      p_period_id: params.p_period_id,
      p_entry_date: params.p_entry_date,
      p_entry_type: params.p_entry_type,
      p_narration: params.p_narration,
      p_created_by: params.p_created_by,
      p_lines: params.p_lines,
      p_reference_number: params.p_reference_number ?? null,
      p_recurring_template_id: params.p_recurring_template_id ?? null,
      p_attachments: params.p_attachments ?? [],
    });

    if (error) {
      throw error;
    }

    return this.parseJournalPayload(data);
  }

  async findByIdWithDetails(id: string): Promise<JournalEntryWithDetails | null> {
    const { data: entry, error: entryError } = await this.supabase.client
      .from('journal_entries')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (entryError) {
      throw entryError;
    }

    if (!entry) {
      return null;
    }

    const { data: lines, error: linesError } = await this.supabase.client
      .from('journal_lines')
      .select('*')
      .eq('journal_entry_id', id)
      .order('line_number');

    if (linesError) {
      throw linesError;
    }

    const attachments = await this.findAttachmentsByEntryId(id);

    return {
      entry: entry as JournalEntry,
      lines: (lines ?? []) as JournalLine[],
      attachments,
    };
  }

  async findAttachmentsByEntryId(entryId: string): Promise<JournalAttachment[]> {
    const { data, error } = await this.supabase.client
      .from('journal_attachments')
      .select('*')
      .eq('journal_entry_id', entryId)
      .order('uploaded_at');

    if (error) {
      throw error;
    }

    return (data ?? []) as JournalAttachment[];
  }

  async findPeriodById(id: string): Promise<AccountingPeriod | null> {
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

  async findNextOpenPeriod(
    companyId: string,
    afterPeriodEnd: string,
  ): Promise<AccountingPeriod | null> {
    const { data, error } = await this.supabase.client
      .from('accounting_periods')
      .select('*')
      .eq('company_id', companyId)
      .eq('status', PeriodStatus.Open)
      .gt('period_start', afterPeriodEnd)
      .order('period_start', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as AccountingPeriod | null;
  }

  async findEarliestOpenPeriod(
    companyId: string,
    fiscalYear: number,
  ): Promise<AccountingPeriod | null> {
    const { data, error } = await this.supabase.client
      .from('accounting_periods')
      .select('*')
      .eq('company_id', companyId)
      .eq('fiscal_year', fiscalYear)
      .eq('status', PeriodStatus.Open)
      .order('period_start', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as AccountingPeriod | null;
  }

  /**
   * [Product decision 2026-08-21] One opening_balance per company per fiscal year.
   */
  async hasOpeningBalanceForFiscalYear(
    companyId: string,
    fiscalYear: number,
  ): Promise<boolean> {
    const { data: periods, error: periodError } = await this.supabase.client
      .from('accounting_periods')
      .select('id')
      .eq('company_id', companyId)
      .eq('fiscal_year', fiscalYear);

    if (periodError) {
      throw periodError;
    }

    const periodIds = (periods ?? []).map((period) => period.id);
    if (!periodIds.length) {
      return false;
    }

    const { data: entries, error: entryError } = await this.supabase.client
      .from('journal_entries')
      .select('id')
      .eq('company_id', companyId)
      .eq('entry_type', JournalEntryType.OpeningBalance)
      .in('period_id', periodIds)
      .limit(1);

    if (entryError) {
      throw entryError;
    }

    return (entries?.length ?? 0) > 0;
  }

  /**
   * [Product decision 2026-08-21] One year_end_closing per company per fiscal year.
   */
  async hasYearEndClosingForFiscalYear(
    companyId: string,
    fiscalYear: number,
  ): Promise<boolean> {
    const { data: periods, error: periodError } = await this.supabase.client
      .from('accounting_periods')
      .select('id')
      .eq('company_id', companyId)
      .eq('fiscal_year', fiscalYear);

    if (periodError) {
      throw periodError;
    }

    const periodIds = (periods ?? []).map((period) => period.id);
    if (!periodIds.length) {
      return false;
    }

    const { data: entries, error: entryError } = await this.supabase.client
      .from('journal_entries')
      .select('id')
      .eq('company_id', companyId)
      .eq('entry_type', JournalEntryType.YearEndClosing)
      .in('period_id', periodIds)
      .limit(1);

    if (entryError) {
      throw entryError;
    }

    return (entries?.length ?? 0) > 0;
  }

  async findLatestPeriodForFiscalYear(
    companyId: string,
    fiscalYear: number,
  ): Promise<AccountingPeriod | null> {
    const { data, error } = await this.supabase.client
      .from('accounting_periods')
      .select('*')
      .eq('company_id', companyId)
      .eq('fiscal_year', fiscalYear)
      .order('period_end', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as AccountingPeriod | null;
  }

  async findRetainedEarningsAccount(companyId: string): Promise<{ id: string } | null> {
    const { data, error } = await this.supabase.client
      .from('accounts')
      .select('id')
      .eq('company_id', companyId)
      .eq('account_number', '3100')
      .eq('is_system_account', true)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as { id: string } | null;
  }

  /**
   * Sum posted P&L activity for a fiscal year — [Rules §4.11].
   * Balance-sheet accounts are excluded; only income and expense lines count.
   */
  async getProfitAndLossBalancesForFiscalYear(
    companyId: string,
    fiscalYear: number,
  ): Promise<ProfitAndLossAccountBalance[]> {
    const { data: periods, error: periodError } = await this.supabase.client
      .from('accounting_periods')
      .select('id')
      .eq('company_id', companyId)
      .eq('fiscal_year', fiscalYear);

    if (periodError) {
      throw periodError;
    }

    const periodIds = (periods ?? []).map((period) => period.id);
    if (!periodIds.length) {
      return [];
    }

    const { data: entries, error: entryError } = await this.supabase.client
      .from('journal_entries')
      .select('id')
      .eq('company_id', companyId)
      .eq('status', JournalEntryStatus.Posted)
      .in('period_id', periodIds);

    if (entryError) {
      throw entryError;
    }

    const entryIds = (entries ?? []).map((entry) => entry.id);
    if (!entryIds.length) {
      return [];
    }

    const { data: lines, error: linesError } = await this.supabase.client
      .from('journal_lines')
      .select('account_id, debit, credit, accounts!inner(category, normal_balance)')
      .in('journal_entry_id', entryIds);

    if (linesError) {
      throw linesError;
    }

    const aggregates = new Map<
      string,
      {
        category: AccountCategory;
        normal_balance: NormalBalance;
        total_debit: number;
        total_credit: number;
      }
    >();

    for (const line of lines ?? []) {
      const accountRaw = line.accounts as unknown;
      const account = (Array.isArray(accountRaw) ? accountRaw[0] : accountRaw) as {
        category: AccountCategory;
        normal_balance: NormalBalance;
      } | null;

      if (
        !account ||
        (account.category !== AccountCategory.Income &&
          account.category !== AccountCategory.Expense)
      ) {
        continue;
      }

      const existing = aggregates.get(line.account_id) ?? {
        category: account.category,
        normal_balance: account.normal_balance,
        total_debit: 0,
        total_credit: 0,
      };

      existing.total_debit += Number(line.debit);
      existing.total_credit += Number(line.credit);
      aggregates.set(line.account_id, existing);
    }

    return [...aggregates.entries()]
      .map(([accountId, totals]) => ({
        account_id: accountId,
        category: totals.category,
        normal_balance: totals.normal_balance,
        total_debit: totals.total_debit,
        total_credit: totals.total_credit,
        balance: computeAccountBalance(
          totals.normal_balance,
          totals.total_debit,
          totals.total_credit,
        ),
      }))
      .filter((row) => row.balance !== 0);
  }

  async createOpeningBalanceEntry(
    dto: CreateOpeningBalanceWithActor,
  ): Promise<JournalEntryWithDetails> {
    const { data, error } = await this.supabase.client.rpc('create_opening_balance_entry', {
      p_company_id: dto.company_id,
      p_fiscal_year: dto.fiscal_year,
      p_entry_date: dto.entry_date,
      p_narration: dto.narration,
      p_created_by: dto.created_by,
      p_lines: dto.lines,
      p_reference_number: dto.reference_number ?? null,
    });

    if (error) {
      throw this.mapJournalRpcError(error);
    }

    return this.parseJournalPayload(data);
  }

  async createYearEndClosingEntry(
    dto: CreateYearEndClosingWithActor,
  ): Promise<JournalEntryWithDetails> {
    const { data, error } = await this.supabase.client.rpc('create_year_end_closing_entry', {
      p_company_id: dto.company_id,
      p_fiscal_year: dto.fiscal_year,
      p_created_by: dto.created_by,
      p_entry_date: dto.entry_date ?? null,
      p_narration: dto.narration ?? null,
    });

    if (error) {
      throw this.mapJournalRpcError(error);
    }

    return this.parseJournalPayload(data);
  }

  /**
   * Promote known RAISE EXCEPTION tokens so Nest can map them without
   * depending on PostgREST wrapping. Tokens are prefixes of the message.
   */
  private mapJournalRpcError(error: { message?: string }): Error {
    const message = error.message ?? '';
    const tokens = [
      'OPENING_BALANCE_ALREADY_EXISTS',
      'YEAR_END_ALREADY_CLOSED',
      'NO_OPEN_PERIOD_FOR_FISCAL_YEAR',
      'NO_PERIOD_FOR_FISCAL_YEAR',
      'RETAINED_EARNINGS_NOT_FOUND',
      'NO_PL_BALANCES_TO_CLOSE',
      'JOURNAL_DRAFT_REQUIRES_LINES',
    ] as const;

    for (const token of tokens) {
      if (message.includes(token)) {
        return new Error(token);
      }
    }

    return error as Error;
  }

  async deleteEntry(id: string): Promise<void> {
    await this.supabase.client.from('journal_lines').delete().eq('journal_entry_id', id);
    await this.supabase.client
      .from('journal_attachments')
      .delete()
      .eq('journal_entry_id', id);
    const { error } = await this.supabase.client.from('journal_entries').delete().eq('id', id);

    if (error) {
      throw error;
    }
  }

  async getAccountTrialBalance(
    companyId: string,
    accountId: string,
  ): Promise<AccountTrialBalance | null> {
    const { data, error } = await this.supabase.client
      .from('v_trial_balance')
      .select('account_id, total_debit, total_credit, balance')
      .eq('company_id', companyId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    return {
      account_id: data.account_id,
      total_debit: Number(data.total_debit),
      total_credit: Number(data.total_credit),
      balance: Number(data.balance),
    };
  }

  async getCompanySettings(companyId: string): Promise<CompanySettings | null> {
    const { data, error } = await this.supabase.client
      .from('company_settings')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as CompanySettings | null;
  }

  async submitForApproval(id: string): Promise<JournalEntry> {
    const { data, error } = await this.supabase.client
      .from('journal_entries')
      .update({
        status: JournalEntryStatus.PendingApproval,
        requires_approval: true,
      })
      .eq('id', id)
      .eq('status', JournalEntryStatus.Draft)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as JournalEntry;
  }

  async approveAndPostEntry(id: string, approvedBy: string): Promise<JournalEntry> {
    const now = new Date().toISOString();

    const { data, error } = await this.supabase.client
      .from('journal_entries')
      .update({
        status: JournalEntryStatus.Posted,
        posted_at: now,
        approved_by: approvedBy,
        approved_at: now,
      })
      .eq('id', id)
      .eq('status', JournalEntryStatus.PendingApproval)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as JournalEntry;
  }

  async rejectEntry(
    id: string,
    rejectedBy: string,
    reason: string,
  ): Promise<JournalEntry> {
    const now = new Date().toISOString();

    const { data, error } = await this.supabase.client
      .from('journal_entries')
      .update({
        status: JournalEntryStatus.Rejected,
        rejected_by: rejectedBy,
        rejected_at: now,
        rejection_reason: reason,
      })
      .eq('id', id)
      .eq('status', JournalEntryStatus.PendingApproval)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as JournalEntry;
  }

  /**
   * Transition draft → posted. Balance enforced by enforce_journal_balance_on_post.
   * posted_at set by application layer on successful transition.
   */
  async postEntry(id: string): Promise<JournalEntry> {
    const postedAt = new Date().toISOString();

    const { data, error } = await this.supabase.client
      .from('journal_entries')
      .update({
        status: JournalEntryStatus.Posted,
        posted_at: postedAt,
      })
      .eq('id', id)
      .eq('status', JournalEntryStatus.Draft)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as JournalEntry;
  }

  /**
   * [feature-spec] One-click reversal in the next open period.
   * [Rules §1.3] Corrections via reversing entries — no hard deletes.
   * Atomic via reverse_journal_entry() Postgres RPC (single transaction).
   */
  async reverseEntry(
    originalId: string,
    createdBy: string,
  ): Promise<JournalEntryReversalResult> {
    const originalDetails = await this.findByIdWithDetails(originalId);
    if (!originalDetails) {
      throw new Error(`Journal entry ${originalId} not found`);
    }

    const { data, error } = await this.supabase.client.rpc('reverse_journal_entry', {
      p_original_id: originalId,
      p_created_by: createdBy,
      p_fail_before_original_update: false,
    });

    if (error) {
      if (error.message?.includes('NO_NEXT_OPEN_PERIOD')) {
        throw new Error('NO_NEXT_OPEN_PERIOD');
      }
      throw error;
    }

    const payload = data as {
      original: JournalEntry;
      reversal: JournalEntry;
      reversal_lines: JournalLine[];
    };

    return {
      original: {
        entry: payload.original,
        lines: originalDetails.lines,
        attachments: originalDetails.attachments,
      },
      reversal: {
        entry: payload.reversal,
        lines: payload.reversal_lines ?? [],
        attachments: [],
      },
    };
  }

  async updateLine(id: string, dto: UpdateJournalLineDto): Promise<JournalLine> {
    const payload: Record<string, unknown> = {};
    if (dto.line_number !== undefined) payload.line_number = dto.line_number;
    if (dto.account_id !== undefined) payload.account_id = dto.account_id;
    if (dto.debit !== undefined) payload.debit = dto.debit;
    if (dto.credit !== undefined) payload.credit = dto.credit;
    if (dto.description !== undefined) payload.description = dto.description;
    if (dto.cost_center !== undefined) payload.cost_center = dto.cost_center;

    const { data, error } = await this.supabase.client
      .from('journal_lines')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as JournalLine;
  }

  async deleteLine(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('journal_lines')
      .delete()
      .eq('id', id);

    if (error) {
      throw error;
    }
  }

  /** [Rules §3.1] Sum total_debit and total_credit across v_trial_balance for a company. */
  async getTrialBalanceTotals(companyId: string): Promise<TrialBalanceTotals> {
    const { data, error } = await this.supabase.client
      .from('v_trial_balance')
      .select('total_debit, total_credit')
      .eq('company_id', companyId);

    if (error) {
      throw error;
    }

    const rows = data ?? [];
    return {
      total_debit: rows.reduce((sum, row) => sum + Number(row.total_debit), 0),
      total_credit: rows.reduce((sum, row) => sum + Number(row.total_credit), 0),
    };
  }

  /** Generated from recurring template — entry_type recurring, starts as draft. */
  async insertGeneratedFromTemplate(
    params: InsertGeneratedJournalEntryParams,
  ): Promise<JournalEntryWithDetails> {
    return this.insertJournalEntryDraftRpc({
      p_company_id: params.company_id,
      p_period_id: params.period_id,
      p_entry_date: params.entry_date,
      p_entry_type: JournalEntryType.Recurring,
      p_narration: params.narration,
      p_created_by: params.created_by,
      p_lines: params.lines,
      p_recurring_template_id: params.recurring_template_id,
    });
  }
}
