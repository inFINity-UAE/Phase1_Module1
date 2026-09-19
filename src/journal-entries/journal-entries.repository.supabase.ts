import { Injectable, BadRequestException } from '@nestjs/common';
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
import { CreateJournalLineDto } from './dto/create-journal-line.dto';
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
import {
  InsertGeneratedJournalEntryParams,
  GenerateDueRecurringEntryResult,
  CreateJournalEntryWithActor,
  CreateOpeningBalanceWithActor,
  CreateYearEndClosingWithActor,
  JournalEntriesRepository,
} from './journal-entries.repository';
import {
  assertAccountsUsableForCompany,
  assertOpeningBalanceAccountsUsable,
} from './journal-line-account.validation';
import {
  assertEntryDateWithinPeriod,
  assertPeriodUsableForCompany,
  assertRecurringTemplateUsableForCompany,
} from './journal-period.validation';

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

  private async assertAccountsUsableForCompany(
    companyId: string,
    accountIds: string[],
  ): Promise<void> {
    // [feature-spec.md decisions #35 / #39] Shared by insert_journal_entry_draft,
    // insertLine, createOpeningBalanceEntry, and updateLine (when account_id changes).
    const uniqueIds = [...new Set(accountIds.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return;
    }

    const { data, error } = await this.supabase.client
      .from('accounts')
      .select('id, company_id, is_active, account_number')
      .in('id', uniqueIds);

    if (error) {
      throw error;
    }

    assertAccountsUsableForCompany(companyId, uniqueIds, data ?? []);
  }

  private async assertPeriodUsableForCompany(
    companyId: string,
    periodId: string,
    entryDate?: string,
  ): Promise<void> {
    // [feature-spec.md §7.26 finding #1] Shared by insert_journal_entry_draft paths.
    if (!periodId) {
      return;
    }

    const { data, error } = await this.supabase.client
      .from('accounting_periods')
      .select('id, company_id, period_start, period_end')
      .eq('id', periodId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    assertPeriodUsableForCompany(companyId, periodId, data ?? null);

    if (entryDate !== undefined) {
      assertEntryDateWithinPeriod(entryDate, data ?? null);
    }
  }

  private async assertRecurringTemplateUsableForCompany(
    companyId: string,
    templateId: string | null | undefined,
  ): Promise<void> {
    // [§7.30 audit] Same-company check for recurring_template_id on draft creates.
    if (!templateId) {
      return;
    }

    const { data, error } = await this.supabase.client
      .from('recurring_journal_templates')
      .select('id, company_id')
      .eq('id', templateId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    assertRecurringTemplateUsableForCompany(companyId, templateId, data ?? null);
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
    const lines = Array.isArray(params.p_lines) ? params.p_lines : [];
    await this.assertPeriodUsableForCompany(
      params.p_company_id,
      params.p_period_id,
      params.p_entry_date,
    );
    await this.assertRecurringTemplateUsableForCompany(
      params.p_company_id,
      params.p_recurring_template_id,
    );
    await this.assertAccountsUsableForCompany(
      params.p_company_id,
      lines.map((line) => String((line as { account_id?: string }).account_id ?? '')),
    );

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

  /**
   * [feature-spec.md decision #31] Company-scoped list — most recent first.
   */
  async findByCompany(
    companyId: string,
    filters?: { status?: string; period_id?: string },
  ): Promise<JournalEntry[]> {
    let query = this.supabase.client
      .from('journal_entries')
      .select('*')
      .eq('company_id', companyId)
      .order('entry_date', { ascending: false })
      .order('entry_number', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.period_id) {
      query = query.eq('period_id', filters.period_id);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return (data ?? []) as JournalEntry[];
  }

  /**
   * [feature-spec.md decision #31] Draft-only header update. Caller must
   * already have verified status = draft — schema.sql has no header
   * immutability trigger (only prevent_posted_line_mutation /
   * prevent_posted_entry_deletion).
   */
  async updateDraftHeader(
    id: string,
    patch: {
      narration?: string;
      reference_number?: string | null;
      entry_date?: string;
      attachments?: Array<{
        file_name: string;
        file_url: string;
        file_size_bytes?: number;
      }>;
      uploaded_by: string;
    },
  ): Promise<JournalEntryWithDetails> {
    const headerPatch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (patch.narration !== undefined) {
      headerPatch.narration = patch.narration;
    }
    if (patch.reference_number !== undefined) {
      headerPatch.reference_number = patch.reference_number;
    }
    if (patch.entry_date !== undefined) {
      headerPatch.entry_date = patch.entry_date;
    }

    // Optimistic draft filter — service already checks status; DB trigger
    // trg_prevent_nondraft_header_mutation (#38) is the PostgREST backstop.
    const { data: updatedRows, error: updateError } = await this.supabase.client
      .from('journal_entries')
      .update(headerPatch)
      .eq('id', id)
      .eq('status', JournalEntryStatus.Draft)
      .select('id');

    if (updateError) {
      throw updateError;
    }
    if (!updatedRows?.length) {
      throw new Error('JOURNAL_ENTRY_HEADER_NOT_DRAFT');
    }

    if (patch.attachments !== undefined) {
      const { error: deleteError } = await this.supabase.client
        .from('journal_attachments')
        .delete()
        .eq('journal_entry_id', id);

      if (deleteError) {
        throw deleteError;
      }

      if (patch.attachments.length > 0) {
        const { error: insertError } = await this.supabase.client
          .from('journal_attachments')
          .insert(
            patch.attachments.map((attachment) => ({
              journal_entry_id: id,
              file_name: attachment.file_name,
              file_url: attachment.file_url,
              file_size_bytes: attachment.file_size_bytes ?? null,
              uploaded_by: patch.uploaded_by,
            })),
          );

        if (insertError) {
          throw insertError;
        }
      }
    }

    const refreshed = await this.findByIdWithDetails(id);
    if (!refreshed) {
      throw new Error(`Journal entry ${id} not found after header update`);
    }
    return refreshed;
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

  /**
   * [feature-spec.md #56] Resolve line + parent company_id for blocked-delete audit.
   */
  async findLineWithCompany(
    id: string,
  ): Promise<{ line: JournalLine; company_id: string } | null> {
    const { data, error } = await this.supabase.client
      .from('journal_lines')
      .select('*, journal_entries!inner(company_id)')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    const { journal_entries: parent, ...line } = data as JournalLine & {
      journal_entries: { company_id: string };
    };

    return {
      line: line as JournalLine,
      company_id: parent.company_id,
    };
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
   * Fiscal-year P&L balances — [Rules §4.11 / feature-spec.md #64].
   * Delegates to `get_profit_and_loss` RPC (is_ledger_truth_status lockstep
   * with year-end close #61 and H1 reports) — no Nest-side status filter.
   */
  async getProfitAndLossBalancesForFiscalYear(
    companyId: string,
    fiscalYear: number,
  ): Promise<ProfitAndLossAccountBalance[]> {
    const { data: periods, error: periodError } = await this.supabase.client
      .from('accounting_periods')
      .select('period_start, period_end')
      .eq('company_id', companyId)
      .eq('fiscal_year', fiscalYear);

    if (periodError) {
      throw periodError;
    }

    if (!periods?.length) {
      return [];
    }

    let periodStart = periods[0].period_start as string;
    let periodEnd = periods[0].period_end as string;
    for (const period of periods) {
      const start = period.period_start as string;
      const end = period.period_end as string;
      if (start < periodStart) {
        periodStart = start;
      }
      if (end > periodEnd) {
        periodEnd = end;
      }
    }

    const { data, error } = await this.supabase.client.rpc('get_profit_and_loss', {
      p_company_id: companyId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
    });

    if (error) {
      throw error;
    }

    return ((data as Record<string, unknown>[]) ?? []).map((row) => ({
      account_id: String(row.account_id),
      category: row.category as AccountCategory,
      normal_balance: row.normal_balance as NormalBalance,
      total_debit: Number(row.total_debit),
      total_credit: Number(row.total_credit),
      balance: Number(row.balance),
    }));
  }

  async createOpeningBalanceEntry(
    dto: CreateOpeningBalanceWithActor,
  ): Promise<JournalEntryWithDetails> {
    const accountIds = dto.lines.map((line) => line.account_id);
    const uniqueIds = [...new Set(accountIds.filter(Boolean))];

    if (uniqueIds.length > 0) {
      const { data, error } = await this.supabase.client
        .from('accounts')
        .select('id, company_id, is_active, account_number, category')
        .in('id', uniqueIds);

      if (error) {
        throw error;
      }

      // [feature-spec.md decisions #39 / #57] Same-company + active (#35) and
      // balance-sheet categories only; RPC repeats category check as DB backstop.
      assertOpeningBalanceAccountsUsable(dto.company_id, accountIds, data ?? []);
    }

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
      p_skip_ct_check: dto.skip_ct_check ?? false,
      p_skip_reason: dto.skip_reason ?? null,
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
      'OPENING_BALANCE_INVALID_ACCOUNT_CATEGORY',
      'YEAR_END_ALREADY_CLOSED',
      'CT_PROVISION_NOT_POSTED',
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

  /**
   * Hard-delete a journal entry. Drafts cascade-delete lines/attachments.
   * Posted rows are rejected by trg_prevent_posted_entry_deletion
   * (POSTED_ENTRY_DELETE_BLOCKED) — do not delete children first, or a
   * failed child delete could leave attachments stripped while the entry
   * remains. [feature-spec.md #56]
   */
  async deleteEntry(id: string): Promise<void> {
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
   * [feature-spec.md #55] When approvedBy is provided (Owner posting their own
   * entry), stamp approved_by/approved_at so log_journal_entry_change can label
   * the audit row 'Self-approved by Owner'.
   */
  async postEntry(id: string, approvedBy?: string): Promise<JournalEntry> {
    const postedAt = new Date().toISOString();
    const payload: Record<string, unknown> = {
      status: JournalEntryStatus.Posted,
      posted_at: postedAt,
    };
    if (approvedBy) {
      payload.approved_by = approvedBy;
      payload.approved_at = postedAt;
    }

    const { data, error } = await this.supabase.client
      .from('journal_entries')
      .update(payload)
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

  async insertLine(dto: CreateJournalLineDto): Promise<JournalLine> {
    // [feature-spec.md decision #32] Posted-parent rejection is DB-only
    // (trg_prevent_posted_line_update). Debit/credit XOR is the table CHECK.
    // [feature-spec.md decision #35] Same-company + active account check (shared helper).
    const { data: parent, error: parentError } = await this.supabase.client
      .from('journal_entries')
      .select('company_id')
      .eq('id', dto.journal_entry_id)
      .maybeSingle();

    if (parentError) {
      throw parentError;
    }
    if (!parent) {
      throw new BadRequestException(
        `Journal entry ${dto.journal_entry_id} was not found — cannot add lines`,
      );
    }

    await this.assertAccountsUsableForCompany(parent.company_id as string, [dto.account_id]);

    const { data, error } = await this.supabase.client
      .from('journal_lines')
      .insert({
        journal_entry_id: dto.journal_entry_id,
        line_number: dto.line_number,
        account_id: dto.account_id,
        debit: dto.debit ?? 0,
        credit: dto.credit ?? 0,
        description: dto.description ?? null,
        cost_center: dto.cost_center ?? null,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as JournalLine;
  }

  async updateLine(id: string, dto: UpdateJournalLineDto): Promise<JournalLine> {
    const payload: Record<string, unknown> = {};
    if (dto.line_number !== undefined) payload.line_number = dto.line_number;
    if (dto.account_id !== undefined) payload.account_id = dto.account_id;
    if (dto.debit !== undefined) payload.debit = dto.debit;
    if (dto.credit !== undefined) payload.credit = dto.credit;
    if (dto.description !== undefined) payload.description = dto.description;
    if (dto.cost_center !== undefined) payload.cost_center = dto.cost_center;

    // [feature-spec.md decision #39] Only when account_id is actually changing.
    if (dto.account_id !== undefined) {
      const { data: line, error: lineError } = await this.supabase.client
        .from('journal_lines')
        .select('journal_entry_id')
        .eq('id', id)
        .maybeSingle();

      if (lineError) {
        throw lineError;
      }
      if (!line) {
        throw new BadRequestException(
          `Journal line ${id} was not found — cannot update`,
        );
      }

      const { data: parent, error: parentError } = await this.supabase.client
        .from('journal_entries')
        .select('company_id')
        .eq('id', line.journal_entry_id as string)
        .maybeSingle();

      if (parentError) {
        throw parentError;
      }
      if (!parent) {
        throw new BadRequestException(
          `Journal entry ${line.journal_entry_id as string} was not found — cannot update lines`,
        );
      }

      await this.assertAccountsUsableForCompany(parent.company_id as string, [
        dto.account_id,
      ]);
    }

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

  /**
   * [feature-spec.md decision #63] Due generation under `rjt:` lock —
   * cron (#62) and manual run-due/generate share this RPC.
   */
  async generateDueRecurringEntry(
    templateId: string,
    asOfDate: string,
  ): Promise<GenerateDueRecurringEntryResult> {
    const { data, error } = await this.supabase.client.rpc(
      'generate_due_recurring_entry',
      {
        p_template_id: templateId,
        p_as_of_date: asOfDate,
      },
    );

    if (error) {
      throw error;
    }

    const payload = data as {
      skipped: boolean;
      skip_reason?: string;
      template_id: string;
      template_name?: string;
      auto_post?: boolean;
      previous_next_run_date?: string;
      next_run_date: string;
      is_active?: boolean;
      entry?: JournalEntry;
      lines?: JournalLine[];
      attachments?: JournalAttachment[];
    };

    if (payload.skipped) {
      return {
        skipped: true,
        skip_reason: payload.skip_reason ?? 'TEMPLATE_NOT_DUE',
        template_id: payload.template_id,
        next_run_date: String(payload.next_run_date),
      };
    }

    return {
      skipped: false,
      template_id: payload.template_id,
      template_name: payload.template_name ?? '',
      auto_post: Boolean(payload.auto_post),
      previous_next_run_date: String(payload.previous_next_run_date),
      next_run_date: String(payload.next_run_date),
      is_active: payload.is_active !== false,
      journal: this.parseJournalPayload({
        entry: payload.entry,
        lines: payload.lines,
        attachments: payload.attachments,
      }),
    };
  }

  /** [feature-spec-1_1_E.md E-21] Manual GRNI accrual — not a second scheduler. */
  async accrueUnbilledReceipts(
    companyId: string,
    periodEndDate: string,
    createdBy: string,
  ): Promise<unknown> {
    const { data, error } = await this.supabase.client.rpc('accrue_unbilled_receipts', {
      p_company_id: companyId,
      p_period_end_date: periodEndDate,
      p_created_by: createdBy,
    });

    if (error) {
      throw error;
    }

    return data;
  }
}
