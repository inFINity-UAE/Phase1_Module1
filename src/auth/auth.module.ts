import { Module } from '@nestjs/common';
import { CompanyMembersModule } from '../company-members/company-members.module';
import { DatabaseModule } from '../database/database.module';
import { JournalEntryCompanyRoleGuard } from './guards/journal-entry-company-role.guard';
import { SupabaseAuthGuard } from './guards/supabase-auth.guard';

@Module({
  imports: [DatabaseModule, CompanyMembersModule],
  providers: [SupabaseAuthGuard, JournalEntryCompanyRoleGuard],
  exports: [SupabaseAuthGuard, JournalEntryCompanyRoleGuard, CompanyMembersModule],
})
export class AuthModule {}
