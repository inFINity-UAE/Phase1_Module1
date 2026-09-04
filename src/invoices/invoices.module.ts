import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { InvoiceLinesController } from './invoice-lines.controller';
import { INVOICES_REPOSITORY } from './invoices.repository';
import { SupabaseInvoicesRepository } from './invoices.repository.supabase';
import { InvoicesController } from './invoices.controller';
import { InvoicesSchedulerService } from './invoices-scheduler.service';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [InvoicesController, InvoiceLinesController],
  providers: [
    InvoicesService,
    InvoicesSchedulerService,
    { provide: INVOICES_REPOSITORY, useClass: SupabaseInvoicesRepository },
  ],
  exports: [InvoicesService, InvoicesSchedulerService, INVOICES_REPOSITORY],
})
export class InvoicesModule {}
