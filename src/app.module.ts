import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { AccountsModule } from './accounts/accounts.module';
import { AccountingPeriodsModule } from './accounting-periods/accounting-periods.module';
import { JournalEntriesModule } from './journal-entries/journal-entries.module';

@Module({
  imports: [DatabaseModule, AccountsModule, AccountingPeriodsModule, JournalEntriesModule],
})
export class AppModule {}
