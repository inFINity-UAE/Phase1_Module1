import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { QuotationsModule } from '../quotations/quotations.module';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import {
  RecurringJournalTemplateLinesController,
  RecurringJournalTemplatesController,
} from './recurring-journal-templates.controller';
import { RecurringJournalSchedulerService } from './recurring-journal-scheduler.service';
import { RecurringJournalTemplatesService } from './recurring-journal-templates.service';
import { RECURRING_JOURNAL_TEMPLATES_REPOSITORY } from './recurring-journal-templates.repository';
import { SupabaseRecurringJournalTemplatesRepository } from './recurring-journal-templates.repository.supabase';

@Module({
  imports: [JournalEntriesModule, AuthModule, QuotationsModule, InvoicesModule],
  controllers: [
    RecurringJournalTemplatesController,
    RecurringJournalTemplateLinesController,
  ],
  providers: [
    RecurringJournalTemplatesService,
    RecurringJournalSchedulerService,
    {
      provide: RECURRING_JOURNAL_TEMPLATES_REPOSITORY,
      useClass: SupabaseRecurringJournalTemplatesRepository,
    },
  ],
  exports: [RecurringJournalTemplatesService, RecurringJournalSchedulerService],
})
export class RecurringJournalTemplatesModule {}
