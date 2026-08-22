import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';
import { UpdateJournalLineDto } from './dto/update-journal-line.dto';
import { AccountingPeriod } from '../accounting-periods/entities/accounting-period.entity';
import { AccountTrialBalance } from './entities/account-trial-balance.entity';
import { JournalEntryWithDetails } from './entities/journal-entry-with-details.entity';
import { JournalAttachment } from './entities/journal-attachment.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalLine } from './entities/journal-line.entity';
import { TrialBalanceTotals } from './entities/trial-balance-totals.entity';
import { JournalEntryReversalResult } from './entities/journal-entry-reversal-result.entity';

export const JOURNAL_ENTRIES_REPOSITORY = Symbol('JOURNAL_ENTRIES_REPOSITORY');

export interface JournalEntriesRepository {
  getNextEntryNumber(companyId: string): Promise<number>;
  insertDraft(dto: CreateJournalEntryDto): Promise<JournalEntryWithDetails>;
  findByIdWithDetails(id: string): Promise<JournalEntryWithDetails | null>;
  findAttachmentsByEntryId(entryId: string): Promise<JournalAttachment[]>;
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
  insertOpeningBalanceDraft(
    dto: CreateOpeningBalanceDto,
    periodId: string,
  ): Promise<JournalEntryWithDetails>;
  deleteEntry(id: string): Promise<void>;
  getAccountTrialBalance(
    companyId: string,
    accountId: string,
  ): Promise<AccountTrialBalance | null>;
  postEntry(id: string): Promise<JournalEntry>;
  reverseEntry(originalId: string, createdBy: string): Promise<JournalEntryReversalResult>;
  updateLine(id: string, dto: UpdateJournalLineDto): Promise<JournalLine>;
  deleteLine(id: string): Promise<void>;
  getTrialBalanceTotals(companyId: string): Promise<TrialBalanceTotals>;
  insertGeneratedFromTemplate(
    params: InsertGeneratedJournalEntryParams,
  ): Promise<JournalEntryWithDetails>;
}

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
