import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PublicHolidaysController } from './public-holidays.controller';
import { PUBLIC_HOLIDAYS_REPOSITORY } from './public-holidays.repository';
import { SupabasePublicHolidaysRepository } from './public-holidays.repository.supabase';
import { PublicHolidaysService } from './public-holidays.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [PublicHolidaysController],
  providers: [
    PublicHolidaysService,
    { provide: PUBLIC_HOLIDAYS_REPOSITORY, useClass: SupabasePublicHolidaysRepository },
  ],
  exports: [PublicHolidaysService],
})
export class PublicHolidaysModule {}
