import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import {
  RecurringJournalTemplateLinesController,
  RecurringJournalTemplatesController,
} from './recurring-journal-templates.controller';
import { RecurringJournalTemplatesService } from './recurring-journal-templates.service';
import { RECURRING_JOURNAL_TEMPLATES_REPOSITORY } from './recurring-journal-templates.repository';
import { SupabaseRecurringJournalTemplatesRepository } from './recurring-journal-templates.repository.supabase';

@Module({
  imports: [JournalEntriesModule, AuthModule],
  controllers: [RecurringJournalTemplatesController, RecurringJournalTemplateLinesController],
  providers: [
    RecurringJournalTemplatesService,
    {
      provide: RECURRING_JOURNAL_TEMPLATES_REPOSITORY,
      useClass: SupabaseRecurringJournalTemplatesRepository,
    },
  ],
})
export class RecurringJournalTemplatesModule {}
