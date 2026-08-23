import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyMembersModule } from '../company-members/company-members.module';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { JournalEntriesController } from './journal-entries.controller';
import { JournalLinesController } from './journal-lines.controller';
import { JournalEntriesService } from './journal-entries.service';
import { JOURNAL_ENTRIES_REPOSITORY } from './journal-entries.repository';
import { SupabaseJournalEntriesRepository } from './journal-entries.repository.supabase';

@Module({
  imports: [AccountingPeriodsModule, AuthModule, CompanyMembersModule],
  controllers: [JournalEntriesController, JournalLinesController],
  providers: [
    JournalEntriesService,
    {
      provide: JOURNAL_ENTRIES_REPOSITORY,
      useClass: SupabaseJournalEntriesRepository,
    },
  ],
  exports: [JOURNAL_ENTRIES_REPOSITORY, JournalEntriesService],
})
export class JournalEntriesModule {}
