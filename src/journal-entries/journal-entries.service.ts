import { Injectable, NotImplementedException } from '@nestjs/common';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto';
import { CreateJournalLineDto } from './dto/create-journal-line.dto';
import { UpdateJournalLineDto } from './dto/update-journal-line.dto';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalLine } from './entities/journal-line.entity';

@Injectable()
export class JournalEntriesService {
  create(_dto: CreateJournalEntryDto): JournalEntry {
    throw new NotImplementedException('Not implemented.');
  }

  findAll(): JournalEntry[] {
    throw new NotImplementedException('Not implemented.');
  }

  findOne(_id: string): JournalEntry {
    throw new NotImplementedException('Not implemented.');
  }

  update(_id: string, _dto: UpdateJournalEntryDto): JournalEntry {
    throw new NotImplementedException('Not implemented.');
  }

  createLine(_dto: CreateJournalLineDto): JournalLine {
    throw new NotImplementedException('Not implemented.');
  }

  updateLine(_id: string, _dto: UpdateJournalLineDto): JournalLine {
    throw new NotImplementedException('Not implemented.');
  }
}
