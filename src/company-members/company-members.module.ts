import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { COMPANY_MEMBERS_REPOSITORY } from './company-members.repository';
import { SupabaseCompanyMembersRepository } from './company-members.repository.supabase';
import { CompanyMembersService } from './company-members.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    CompanyMembersService,
    {
      provide: COMPANY_MEMBERS_REPOSITORY,
      useClass: SupabaseCompanyMembersRepository,
    },
  ],
  exports: [CompanyMembersService, COMPANY_MEMBERS_REPOSITORY],
})
export class CompanyMembersModule {}
