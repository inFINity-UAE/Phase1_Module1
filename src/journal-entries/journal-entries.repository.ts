import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';
import { CreateYearEndClosingDto } from './dto/create-year-end-closing.dto';
import { UpdateJournalLineDto } from './dto/update-journal-line.dto';
import { CreateJournalLineDto } from './dto/create-journal-line.dto';
import { AccountingPeriod } from '../accounting-periods/entities/accounting-period.entity';
import { CompanySettings } from '../company-settings/entities/company-settings.entity';
import { AccountTrialBalance } from './entities/account-trial-balance.entity';
import { JournalEntryWithDetails } from './entities/journal-entry-with-details.entity';
import { JournalAttachment } from './entities/journal-attachment.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalLine } from './entities/journal-line.entity';
import { TrialBalanceTotals } from './entities/trial-balance-totals.entity';
import { ProfitAndLossAccountBalance } from './entities/profit-and-loss-account-balance.entity';
import { JournalEntryReversalResult } from './entities/journal-entry-reversal-result.entity';

export const JOURNAL_ENTRIES_REPOSITORY = Symbol('JOURNAL_ENTRIES_REPOSITORY');

/** Repository payloads include created_by from the authenticated session, not the HTTP body. */
export type CreateJournalEntryWithActor = CreateJournalEntryDto & { created_by: string };
export type CreateOpeningBalanceWithActor = CreateOpeningBalanceDto & { created_by: string };
export type CreateYearEndClosingWithActor = CreateYearEndClosingDto & { created_by: string };

export interface JournalEntriesRepository {
  getNextEntryNumber(companyId: string): Promise<number>;
  insertDraft(dto: CreateJournalEntryWithActor): Promise<JournalEntryWithDetails>;
  findByIdWithDetails(id: string): Promise<JournalEntryWithDetails | null>;
  /**
   * [feature-spec.md decision #31] Company-scoped list with optional status /
   * period_id filters. Ordered entry_date DESC, entry_number DESC.
   */
  findByCompany(
    companyId: string,
    filters?: { status?: string; period_id?: string },
  ): Promise<JournalEntry[]>;
  /**
   * [feature-spec.md decision #31] Draft header patch. When attachments is
   * provided (including []), existing journal_attachments rows are replaced.
   */
  updateDraftHeader(
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
  ): Promise<JournalEntryWithDetails>;
  findAttachmentsByEntryId(entryId: string): Promise<JournalAttachment[]>;
  /**
   * [feature-spec.md #56] Line + parent company for blocked-delete audit.
   */
  findLineWithCompany(id: string): Promise<{
    line: JournalLine;
    company_id: string;
  } | null>;
  findPeriodById(id: string): Promise<AccountingPeriod | null>;
  findNextOpenPeriod(
    companyId: string,
    afterPeriodEnd: string,
  ): Promise<AccountingPeriod | null>;
  findEarliestOpenPeriod(
    companyId: string,
    fiscalYear: number,
  ): Promise<AccountingPeriod | null>;
  hasOpeningBalanceForFiscalYear(
    companyId: string,
    fiscalYear: number,
  ): Promise<boolean>;
  hasYearEndClosingForFiscalYear(
    companyId: string,
    fiscalYear: number,
  ): Promise<boolean>;
  createOpeningBalanceEntry(
    dto: CreateOpeningBalanceWithActor,
  ): Promise<JournalEntryWithDetails>;
  createYearEndClosingEntry(
    dto: CreateYearEndClosingWithActor,
  ): Promise<JournalEntryWithDetails>;
  findLatestPeriodForFiscalYear(
    companyId: string,
    fiscalYear: number,
  ): Promise<AccountingPeriod | null>;
  findRetainedEarningsAccount(companyId: string): Promise<{ id: string } | null>;
  getProfitAndLossBalancesForFiscalYear(
    companyId: string,
    fiscalYear: number,
  ): Promise<ProfitAndLossAccountBalance[]>;
  deleteEntry(id: string): Promise<void>;
  getAccountTrialBalance(
    companyId: string,
    accountId: string,
  ): Promise<AccountTrialBalance | null>;
  getCompanySettings(companyId: string): Promise<CompanySettings | null>;
  submitForApproval(id: string): Promise<JournalEntry>;
  approveAndPostEntry(id: string, approvedBy: string): Promise<JournalEntry>;
  rejectEntry(id: string, rejectedBy: string, reason: string): Promise<JournalEntry>;
  postEntry(id: string, approvedBy?: string): Promise<JournalEntry>;
  reverseEntry(originalId: string, createdBy: string): Promise<JournalEntryReversalResult>;
  /**
   * [feature-spec.md decision #32] Insert one journal_lines row. Posted parents
   * are rejected by trg_prevent_posted_line_update (do not duplicate that check).
   */
  insertLine(dto: CreateJournalLineDto): Promise<JournalLine>;
  updateLine(id: string, dto: UpdateJournalLineDto): Promise<JournalLine>;
  deleteLine(id: string): Promise<void>;
  getTrialBalanceTotals(companyId: string): Promise<TrialBalanceTotals>;
  insertGeneratedFromTemplate(
    params: InsertGeneratedJournalEntryParams,
  ): Promise<JournalEntryWithDetails>;
  /**
   * [feature-spec.md decision #63] Atomic due-claim + draft insert + schedule
   * advance under `rjt:` advisory lock.
   */
  generateDueRecurringEntry(
    templateId: string,
    asOfDate: string,
  ): Promise<GenerateDueRecurringEntryResult>;
  /** [feature-spec-1_1_E.md E-21] Manual GRNI accrual RPC — not a cron. */
  accrueUnbilledReceipts(
    companyId: string,
    periodEndDate: string,
    createdBy: string,
  ): Promise<unknown>;
}

export type GenerateDueRecurringEntryResult =
  | {
      skipped: true;
      skip_reason: string;
      template_id: string;
      next_run_date: string;
    }
  | {
      skipped: false;
      template_id: string;
      template_name: string;
      auto_post: boolean;
      previous_next_run_date: string;
      next_run_date: string;
      is_active: boolean;
      journal: JournalEntryWithDetails;
    };

export interface InsertGeneratedJournalEntryParams {
  company_id: string;
  period_id: string;
  entry_date: string;
  narration: string;
  created_by: string;
  recurring_template_id: string;
  lines: Array<{
    line_number: number;
    account_id: string;
    debit?: number;
    credit?: number;
    description?: string | null;
  }>;
}
