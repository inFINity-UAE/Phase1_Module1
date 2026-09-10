import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PaymentApplicationsController } from './payment-applications.controller';
import { PAYMENTS_REPOSITORY } from './payments.repository';
import { SupabasePaymentsRepository } from './payments.repository.supabase';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [PaymentsController, PaymentApplicationsController],
  providers: [
    PaymentsService,
    { provide: PAYMENTS_REPOSITORY, useClass: SupabasePaymentsRepository },
  ],
  exports: [PaymentsService, PAYMENTS_REPOSITORY],
})
export class PaymentsModule {}
