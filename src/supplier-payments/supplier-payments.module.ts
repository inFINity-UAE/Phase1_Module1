import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { SupplierPaymentRunsController } from './supplier-payment-runs.controller';
import { SupplierPaymentsController } from './supplier-payments.controller';
import { SUPPLIER_PAYMENTS_REPOSITORY } from './supplier-payments.repository';
import { SupabaseSupplierPaymentsRepository } from './supplier-payments.repository.supabase';
import { SupplierPaymentsService } from './supplier-payments.service';
import { SupplierStatementLinesController } from './supplier-statement-lines.controller';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [
    SupplierPaymentsController,
    SupplierPaymentRunsController,
    SupplierStatementLinesController,
  ],
  providers: [
    SupplierPaymentsService,
    { provide: SUPPLIER_PAYMENTS_REPOSITORY, useClass: SupabaseSupplierPaymentsRepository },
  ],
  exports: [SupplierPaymentsService, SUPPLIER_PAYMENTS_REPOSITORY],
})
export class SupplierPaymentsModule {}
