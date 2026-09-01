import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { QuotationLinesController } from './quotation-lines.controller';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';
import { QUOTATIONS_REPOSITORY } from './quotations.repository';
import { SupabaseQuotationsRepository } from './quotations.repository.supabase';

@Module({
  imports: [AuthModule, InvoicesModule],
  controllers: [QuotationsController, QuotationLinesController],
  providers: [
    QuotationsService,
    {
      provide: QUOTATIONS_REPOSITORY,
      useClass: SupabaseQuotationsRepository,
    },
  ],
  exports: [QuotationsService],
})
export class QuotationsModule {}
