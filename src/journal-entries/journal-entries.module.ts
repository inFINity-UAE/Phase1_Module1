import { Module } from '@nestjs/common';
import { JournalEntriesController } from './journal-entries.controller';
import { JournalLinesController } from './journal-lines.controller';
import { JournalEntriesService } from './journal-entries.service';
import { JOURNAL_ENTRIES_REPOSITORY } from './journal-entries.repository';
import { SupabaseJournalEntriesRepository } from './journal-entries.repository.supabase';

@Module({
  controllers: [JournalEntriesController, JournalLinesController],
  providers: [
    JournalEntriesService,
    {
      provide: JOURNAL_ENTRIES_REPOSITORY,
      useClass: SupabaseJournalEntriesRepository,
    },
  ],
  exports: [JOURNAL_ENTRIES_REPOSITORY],
})
export class JournalEntriesModule {}
