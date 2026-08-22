import { Module } from '@nestjs/common';
import { JournalEntriesController } from './journal-entries.controller';
import { JournalLinesController } from './journal-lines.controller';
import { JournalEntriesService } from './journal-entries.service';

@Module({
  controllers: [JournalEntriesController, JournalLinesController],
  providers: [JournalEntriesService],
})
export class JournalEntriesModule {}
