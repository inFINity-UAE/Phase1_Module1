import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReportsController } from './reports.controller';
import { REPORTS_REPOSITORY } from './reports.repository';
import { SupabaseReportsRepository } from './reports.repository.supabase';
import { ReportsService } from './reports.service';

@Module({
  imports: [AuthModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    {
      provide: REPORTS_REPOSITORY,
      useClass: SupabaseReportsRepository,
    },
  ],
})
export class ReportsModule {}
