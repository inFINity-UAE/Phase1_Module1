import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccountingPeriodsController } from './accounting-periods.controller';
import { AccountingPeriodsService } from './accounting-periods.service';
import { ACCOUNTING_PERIODS_REPOSITORY } from './accounting-periods.repository';
import { SupabaseAccountingPeriodsRepository } from './accounting-periods.repository.supabase';

@Module({
  imports: [AuthModule],
  controllers: [AccountingPeriodsController],
  providers: [
    AccountingPeriodsService,
    {
      provide: ACCOUNTING_PERIODS_REPOSITORY,
      useClass: SupabaseAccountingPeriodsRepository,
    },
  ],
  exports: [ACCOUNTING_PERIODS_REPOSITORY],
})
export class AccountingPeriodsModule {}
