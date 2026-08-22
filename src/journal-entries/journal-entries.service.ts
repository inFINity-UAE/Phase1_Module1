import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import {
  handleDatabaseError,
  isPostgrestError,
} from '../common/errors/database-error.mapper';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto';
import { ReverseJournalEntryDto } from './dto/reverse-journal-entry.dto';
import { CreateJournalLineDto } from './dto/create-journal-line.dto';
import { UpdateJournalLineDto } from './dto/update-journal-line.dto';
import { AccountTrialBalance } from './entities/account-trial-balance.entity';
import { JournalEntryWithDetails } from './entities/journal-entry-with-details.entity';
import { JournalEntryReversalResult } from './entities/journal-entry-reversal-result.entity';
import { JournalAttachment } from './entities/journal-attachment.entity';
import { JournalLine } from './entities/journal-line.entity';
import {
  formatUnbalancedPostError,
  isJournalBalancePostRejection,
} from './journal-entry-balance.util';
import {
  JOURNAL_ENTRIES_REPOSITORY,
  JournalEntriesRepository,
} from './journal-entries.repository';

@Injectable()
export class JournalEntriesService {
  constructor(
    @Inject(JOURNAL_ENTRIES_REPOSITORY)
    private readonly journalEntriesRepository: JournalEntriesRepository,
  ) {}

  /**
   * [feature-spec] Manual journal entry as draft — balance enforced on post only
   * [schema] enforce_journal_balance_on_post
   */
  async create(dto: CreateJournalEntryDto): Promise<JournalEntryWithDetails> {
    if (!dto.lines?.length) {
      throw new BadRequestException('Journal entry must have at least one line');
    }

    try {
      return await this.journalEntriesRepository.insertDraft(dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec] Opening balance entry for mid-year setup.
   * [Product decision 2026-08-21] One-time per company per fiscal year.
   * [Rules §1.1] Same balance enforcement on post as any other entry.
   */
  async createOpeningBalance(
    dto: CreateOpeningBalanceDto,
  ): Promise<JournalEntryWithDetails> {
    if (!dto.lines?.length) {
      throw new BadRequestException('Opening balance entry must have at least one line');
    }

    const alreadyExists =
      await this.journalEntriesRepository.hasOpeningBalanceForFiscalYear(
        dto.company_id,
        dto.fiscal_year,
      );
    if (alreadyExists) {
      throw new BadRequestException(
        `An opening balance entry already exists for fiscal year ${dto.fiscal_year}. ` +
          'Use a manual adjusting or reversing entry to correct balances instead.',
      );
    }

    const period = await this.journalEntriesRepository.findEarliestOpenPeriod(
      dto.company_id,
      dto.fiscal_year,
    );
    if (!period) {
      throw new BadRequestException(
        `No open accounting period found for fiscal year ${dto.fiscal_year}`,
      );
    }

    let draft: JournalEntryWithDetails | undefined;

    try {
      draft = await this.journalEntriesRepository.insertOpeningBalanceDraft(
        dto,
        period.id,
      );

      const posted = await this.journalEntriesRepository.postEntry(draft.entry.id);

      if (!posted.posted_at) {
        throw new InternalServerErrorException(
          `Opening balance entry ${posted.entry_number} was posted but posted_at was not set`,
        );
      }

      return this.findOne(draft.entry.id);
    } catch (error) {
      if (draft) {
        await this.journalEntriesRepository.deleteEntry(draft.entry.id);
      }

      if (
        draft &&
        isPostgrestError(error) &&
        error.code === 'P0001' &&
        isJournalBalancePostRejection(error.message)
      ) {
        throw new BadRequestException(
          formatUnbalancedPostError(draft.entry.entry_number, draft.lines),
        );
      }

      handleDatabaseError(error);
    }
  }

  async getAccountTrialBalance(
    companyId: string,
    accountId: string,
  ): Promise<AccountTrialBalance | null> {
    try {
      return await this.journalEntriesRepository.getAccountTrialBalance(
        companyId,
        accountId,
      );
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Post a draft journal entry. [Rules §1.1] debits must equal credits.
   * DB trigger enforce_journal_balance_on_post rejects imbalance at post time.
   */
  async post(id: string): Promise<JournalEntryWithDetails> {
    const existing = await this.findOne(id);

    if (existing.entry.status !== JournalEntryStatus.Draft) {
      throw new BadRequestException(
        `Journal entry ${existing.entry.entry_number} is not a draft and cannot be posted`,
      );
    }

    try {
      const posted = await this.journalEntriesRepository.postEntry(id);

      if (!posted.posted_at) {
        throw new InternalServerErrorException(
          `Journal entry ${posted.entry_number} was posted but posted_at was not set`,
        );
      }

      return this.findOne(id);
    } catch (error) {
      this.handlePostError(error, existing);
    }
  }

  /**
   * [feature-spec] One-click reversal in the next open period.
   * [Rules §1.3] Corrections via reversing entries — preserve audit trail.
   * [Product decision 2026-08-21] An entry cannot be reversed twice.
   */
  async reverse(id: string, dto: ReverseJournalEntryDto): Promise<JournalEntryReversalResult> {
    const existing = await this.findOne(id);
    this.assertReversible(existing);

    const originalPeriod = await this.journalEntriesRepository.findPeriodById(
      existing.entry.period_id,
    );
    if (!originalPeriod) {
      throw new BadRequestException(
        `Accounting period for journal entry ${existing.entry.entry_number} was not found`,
      );
    }

    const nextPeriod = await this.journalEntriesRepository.findNextOpenPeriod(
      existing.entry.company_id,
      originalPeriod.period_end,
    );
    if (!nextPeriod) {
      throw new BadRequestException(
        `No open accounting period exists after ${originalPeriod.period_end} — ` +
          'create the next period before reversing this entry',
      );
    }

    try {
      return await this.journalEntriesRepository.reverseEntry(id, dto.created_by);
    } catch (error) {
      if (error instanceof Error && error.message === 'NO_NEXT_OPEN_PERIOD') {
        throw new BadRequestException(
          `No open accounting period exists after ${originalPeriod.period_end} — ` +
            'create the next period before reversing this entry',
        );
      }
      handleDatabaseError(error);
    }
  }

  findAll(): JournalEntryWithDetails[] {
    throw new NotImplementedException('Not implemented.');
  }

  async findOne(id: string): Promise<JournalEntryWithDetails> {
    try {
      const result = await this.journalEntriesRepository.findByIdWithDetails(id);
      if (!result) {
        throw new NotFoundException(`Journal entry ${id} not found`);
      }
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      handleDatabaseError(error);
    }
  }

  async getAttachments(entryId: string): Promise<JournalAttachment[]> {
    await this.findOne(entryId);
    try {
      return await this.journalEntriesRepository.findAttachmentsByEntryId(entryId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  update(_id: string, _dto: UpdateJournalEntryDto): JournalEntryWithDetails {
    throw new NotImplementedException('Not implemented.');
  }

  createLine(_dto: CreateJournalLineDto) {
    throw new NotImplementedException('Not implemented.');
  }

  async updateLine(id: string, dto: UpdateJournalLineDto): Promise<JournalLine> {
    try {
      return await this.journalEntriesRepository.updateLine(id, dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async deleteLine(id: string): Promise<void> {
    try {
      await this.journalEntriesRepository.deleteLine(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  private handlePostError(
    error: unknown,
    existing: JournalEntryWithDetails,
  ): never {
    if (isPostgrestError(error) && error.code === 'P0001') {
      if (isJournalBalancePostRejection(error.message)) {
        throw new BadRequestException(
          formatUnbalancedPostError(existing.entry.entry_number, existing.lines),
        );
      }
      throw new BadRequestException(error.message);
    }

    handleDatabaseError(error);
  }

  private assertReversible(existing: JournalEntryWithDetails): void {
    const { entry_number, status, reversed_by_entry_id, reverses_entry_id, entry_type } =
      existing.entry;

    if (status === JournalEntryStatus.Reversed || reversed_by_entry_id) {
      throw new BadRequestException(
        `Journal entry ${entry_number} has already been reversed and cannot be reversed again`,
      );
    }

    if (status !== JournalEntryStatus.Posted) {
      throw new BadRequestException(
        `Journal entry ${entry_number} must be posted before it can be reversed`,
      );
    }

    if (entry_type === JournalEntryType.Reversal || reverses_entry_id) {
      throw new BadRequestException(
        `Journal entry ${entry_number} is a reversal entry and cannot be reversed`,
      );
    }
  }
}
