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
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto';
import { CreateJournalLineDto } from './dto/create-journal-line.dto';
import { UpdateJournalLineDto } from './dto/update-journal-line.dto';
import { JournalEntryWithDetails } from './entities/journal-entry-with-details.entity';
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
}
