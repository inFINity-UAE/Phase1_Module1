import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { AccountsModule } from './accounts/accounts.module';
import { AccountingPeriodsModule } from './accounting-periods/accounting-periods.module';
import { JournalEntriesModule } from './journal-entries/journal-entries.module';
import { RecurringJournalTemplatesModule } from './recurring-journal-templates/recurring-journal-templates.module';
import { AuditLogModule } from './audit-log/audit-log.module';

@Module({
  imports: [
    DatabaseModule,
    AccountsModule,
    AccountingPeriodsModule,
    JournalEntriesModule,
    RecurringJournalTemplatesModule,
    AuditLogModule,
  ],
})
export class AppModule {}
