import { Module } from '@nestjs/common';
import { AccountingPeriodsController } from './accounting-periods.controller';
import { AccountingPeriodsService } from './accounting-periods.service';

@Module({
  controllers: [AccountingPeriodsController],
  providers: [AccountingPeriodsService],
})
export class AccountingPeriodsModule {}
