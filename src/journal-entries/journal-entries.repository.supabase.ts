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
import { computeAccountBalance, YearEndClosingLineInput } from './year-end-closing.util';
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
    const { data, error } = await this.supabase.client
      .from('journal_entries')
      .select('entry_number')
      .eq('company_id', companyId)
      .order('entry_number', { ascending: false })
      .limit(1);

    if (error) {
      throw error;
    }

    const max = data?.[0]?.entry_number;
    return typeof max === 'number' ? max + 1 : 1;
  }

  async insertDraft(dto: CreateJournalEntryWithActor): Promise<JournalEntryWithDetails> {
    const entryNumber = await this.getNextEntryNumber(dto.company_id);

    const { data: entry, error: entryError } = await this.supabase.client
      .from('journal_entries')
      .insert({
        company_id: dto.company_id,
        entry_number: entryNumber,
        period_id: dto.period_id,
        entry_date: dto.entry_date,
        entry_type: JournalEntryType.Manual,
        status: JournalEntryStatus.Draft,
        narration: dto.narration,
        reference_number: dto.reference_number ?? null,
        created_by: dto.created_by,
      })
      .select()
      .single();

    if (entryError) {
      throw entryError;
    }

    const entryRow = entry as JournalEntry;

    try {
      const lineRows = dto.lines.map((line) => ({
        journal_entry_id: entryRow.id,
        line_number: line.line_number,
        account_id: line.account_id,
        debit: line.debit ?? 0,
        credit: line.credit ?? 0,
        description: line.description ?? null,
        cost_center: line.cost_center ?? null,
      }));

      const { data: lines, error: linesError } = await this.supabase.client
        .from('journal_lines')
        .insert(lineRows)
        .select();

      if (linesError) {
        throw linesError;
      }

      let attachments: JournalAttachment[] = [];

      if (dto.attachments?.length) {
        const attachmentRows = dto.attachments.map((attachment) => ({
          journal_entry_id: entryRow.id,
          file_name: attachment.file_name,
          file_url: attachment.file_url,
          file_size_bytes: attachment.file_size_bytes ?? null,
          uploaded_by: dto.created_by,
        }));

        const { data: attachmentData, error: attachmentError } =
          await this.supabase.client
            .from('journal_attachments')
            .insert(attachmentRows)
            .select();

        if (attachmentError) {
          throw attachmentError;
        }

        attachments = (attachmentData ?? []) as JournalAttachment[];
      }

      return {
        entry: entryRow,
        lines: (lines ?? []) as JournalLine[],
        attachments,
      };
    } catch (error) {
      await this.supabase.client
        .from('journal_entries')
        .delete()
        .eq('id', entryRow.id);
      throw error;
    }
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

  async insertOpeningBalanceDraft(
    dto: CreateOpeningBalanceWithActor,
    periodId: string,
  ): Promise<JournalEntryWithDetails> {
    const entryNumber = await this.getNextEntryNumber(dto.company_id);

    const { data: entry, error: entryError } = await this.supabase.client
      .from('journal_entries')
      .insert({
        company_id: dto.company_id,
        entry_number: entryNumber,
        period_id: periodId,
        entry_date: dto.entry_date,
        entry_type: JournalEntryType.OpeningBalance,
        status: JournalEntryStatus.Draft,
        narration: dto.narration,
        reference_number: dto.reference_number ?? null,
        created_by: dto.created_by,
      })
      .select()
      .single();

    if (entryError) {
      throw entryError;
    }

    const entryRow = entry as JournalEntry;

    try {
      const lineRows = dto.lines.map((line) => ({
        journal_entry_id: entryRow.id,
        line_number: line.line_number,
        account_id: line.account_id,
        debit: line.debit ?? 0,
        credit: line.credit ?? 0,
        description: line.description ?? null,
        cost_center: line.cost_center ?? null,
      }));

      const { data: lines, error: linesError } = await this.supabase.client
        .from('journal_lines')
        .insert(lineRows)
        .select();

      if (linesError) {
        throw linesError;
      }

      return {
        entry: entryRow,
        lines: (lines ?? []) as JournalLine[],
        attachments: [],
      };
    } catch (error) {
      await this.deleteEntry(entryRow.id);
      throw error;
    }
  }

  async insertYearEndClosingDraft(
    dto: CreateYearEndClosingWithActor,
    periodId: string,
    entryDate: string,
    lines: YearEndClosingLineInput[],
  ): Promise<JournalEntryWithDetails> {
    const entryNumber = await this.getNextEntryNumber(dto.company_id);
    const narration =
      dto.narration?.trim() ||
      `Year-end closing for fiscal year ${dto.fiscal_year}`;

    const { data: entry, error: entryError } = await this.supabase.client
      .from('journal_entries')
      .insert({
        company_id: dto.company_id,
        entry_number: entryNumber,
        period_id: periodId,
        entry_date: entryDate,
        entry_type: JournalEntryType.YearEndClosing,
        status: JournalEntryStatus.Draft,
        narration,
        created_by: dto.created_by,
      })
      .select()
      .single();

    if (entryError) {
      throw entryError;
    }

    const entryRow = entry as JournalEntry;

    try {
      const lineRows = lines.map((line) => ({
        journal_entry_id: entryRow.id,
        line_number: line.line_number,
        account_id: line.account_id,
        debit: line.debit ?? 0,
        credit: line.credit ?? 0,
        description: line.description ?? null,
        cost_center: null,
      }));

      const { data: insertedLines, error: linesError } = await this.supabase.client
        .from('journal_lines')
        .insert(lineRows)
        .select();

      if (linesError) {
        throw linesError;
      }

      return {
        entry: entryRow,
        lines: (insertedLines ?? []) as JournalLine[],
        attachments: [],
      };
    } catch (error) {
      await this.deleteEntry(entryRow.id);
      throw error;
    }
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
    const entryNumber = await this.getNextEntryNumber(params.company_id);

    const { data: entry, error: entryError } = await this.supabase.client
      .from('journal_entries')
      .insert({
        company_id: params.company_id,
        entry_number: entryNumber,
        period_id: params.period_id,
        entry_date: params.entry_date,
        entry_type: JournalEntryType.Recurring,
        status: JournalEntryStatus.Draft,
        narration: params.narration,
        recurring_template_id: params.recurring_template_id,
        created_by: params.created_by,
      })
      .select()
      .single();

    if (entryError) {
      throw entryError;
    }

    const entryRow = entry as JournalEntry;

    try {
      const lineRows = params.lines.map((line) => ({
        journal_entry_id: entryRow.id,
        line_number: line.line_number,
        account_id: line.account_id,
        debit: line.debit ?? 0,
        credit: line.credit ?? 0,
        description: line.description ?? null,
      }));

      const { data: lines, error: linesError } = await this.supabase.client
        .from('journal_lines')
        .insert(lineRows)
        .select();

      if (linesError) {
        throw linesError;
      }

      return {
        entry: entryRow,
        lines: (lines ?? []) as JournalLine[],
        attachments: [],
      };
    } catch (error) {
      await this.deleteEntry(entryRow.id);
      throw error;
    }
  }
}
