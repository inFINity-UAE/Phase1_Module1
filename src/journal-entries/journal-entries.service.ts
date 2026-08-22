import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { handleDatabaseError } from '../common/errors/database-error.mapper';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto';
import { CreateJournalLineDto } from './dto/create-journal-line.dto';
import { UpdateJournalLineDto } from './dto/update-journal-line.dto';
import { JournalEntryWithDetails } from './entities/journal-entry-with-details.entity';
import { JournalAttachment } from './entities/journal-attachment.entity';
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

  updateLine(_id: string, _dto: UpdateJournalLineDto) {
    throw new NotImplementedException('Not implemented.');
  }
}
