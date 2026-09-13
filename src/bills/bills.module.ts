import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { BILLS_REPOSITORY } from './bills.repository';
import { SupabaseBillsRepository } from './bills.repository.supabase';
import { BillsController } from './bills.controller';
import { BillsService } from './bills.service';

@Module({
  imports: [AuthModule, DatabaseModule, JournalEntriesModule],
  controllers: [BillsController],
  providers: [
    BillsService,
    { provide: BILLS_REPOSITORY, useClass: SupabaseBillsRepository },
  ],
  exports: [BillsService, BILLS_REPOSITORY],
})
export class BillsModule {}
