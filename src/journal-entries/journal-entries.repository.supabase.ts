import { Injectable } from '@nestjs/common';
import { PeriodStatus } from '../common/enums/period-status.enum';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { SupabaseService } from '../database/supabase.service';
import { AccountingPeriod } from '../accounting-periods/entities/accounting-period.entity';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';
import { UpdateJournalLineDto } from './dto/update-journal-line.dto';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalLine } from './entities/journal-line.entity';
import { JournalAttachment } from './entities/journal-attachment.entity';
import { JournalEntryWithDetails } from './entities/journal-entry-with-details.entity';
import { JournalEntryReversalResult } from './entities/journal-entry-reversal-result.entity';
import { AccountTrialBalance } from './entities/account-trial-balance.entity';
import { TrialBalanceTotals } from './entities/trial-balance-totals.entity';
import {
  InsertGeneratedJournalEntryParams,
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

  async insertDraft(dto: CreateJournalEntryDto): Promise<JournalEntryWithDetails> {
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

  async insertOpeningBalanceDraft(
    dto: CreateOpeningBalanceDto,
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
   */
  async reverseEntry(
    originalId: string,
    createdBy: string,
  ): Promise<JournalEntryReversalResult> {
    const originalDetails = await this.findByIdWithDetails(originalId);
    if (!originalDetails) {
      throw new Error(`Journal entry ${originalId} not found`);
    }

    const originalPeriod = await this.findPeriodById(originalDetails.entry.period_id);
    if (!originalPeriod) {
      throw new Error(`Accounting period ${originalDetails.entry.period_id} not found`);
    }

    const nextPeriod = await this.findNextOpenPeriod(
      originalDetails.entry.company_id,
      originalPeriod.period_end,
    );
    if (!nextPeriod) {
      throw new Error('NO_NEXT_OPEN_PERIOD');
    }

    const entryNumber = await this.getNextEntryNumber(originalDetails.entry.company_id);
    const postedAt = new Date().toISOString();
    const narration = `Reversal of journal entry ${originalDetails.entry.entry_number}`;

    const { data: reversalEntry, error: reversalError } = await this.supabase.client
      .from('journal_entries')
      .insert({
        company_id: originalDetails.entry.company_id,
        entry_number: entryNumber,
        period_id: nextPeriod.id,
        entry_date: nextPeriod.period_start,
        entry_type: JournalEntryType.Reversal,
        status: JournalEntryStatus.Posted,
        narration,
        reference_number: originalDetails.entry.reference_number,
        reverses_entry_id: originalId,
        created_by: createdBy,
        posted_at: postedAt,
      })
      .select()
      .single();

    if (reversalError) {
      throw reversalError;
    }

    const reversalRow = reversalEntry as JournalEntry;

    try {
      const mirroredLines = originalDetails.lines.map((line) => ({
        journal_entry_id: reversalRow.id,
        line_number: line.line_number,
        account_id: line.account_id,
        debit: line.credit,
        credit: line.debit,
        description: line.description,
        cost_center: line.cost_center,
      }));

      const { data: lines, error: linesError } = await this.supabase.client
        .from('journal_lines')
        .insert(mirroredLines)
        .select();

      if (linesError) {
        throw linesError;
      }

      const { data: updatedOriginal, error: updateError } = await this.supabase.client
        .from('journal_entries')
        .update({
          status: JournalEntryStatus.Reversed,
          reversed_by_entry_id: reversalRow.id,
        })
        .eq('id', originalId)
        .eq('status', JournalEntryStatus.Posted)
        .is('reversed_by_entry_id', null)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      return {
        original: {
          entry: updatedOriginal as JournalEntry,
          lines: originalDetails.lines,
          attachments: originalDetails.attachments,
        },
        reversal: {
          entry: reversalRow,
          lines: (lines ?? []) as JournalLine[],
          attachments: [],
        },
      };
    } catch (error) {
      await this.supabase.client.from('journal_lines').delete().eq('journal_entry_id', reversalRow.id);
      await this.supabase.client.from('journal_entries').delete().eq('id', reversalRow.id);
      throw error;
    }
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
