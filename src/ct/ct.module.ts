import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { CtController } from './ct.controller';
import { CT_REPOSITORY } from './ct.repository';
import { SupabaseCtRepository } from './ct.repository.supabase';
import { CtService } from './ct.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [CtController],
  providers: [CtService, { provide: CT_REPOSITORY, useClass: SupabaseCtRepository }],
  exports: [CtService, CT_REPOSITORY],
})
export class CtModule {}
