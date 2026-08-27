import { Module } from '@nestjs/common';
import { CompanyMembersModule } from '../company-members/company-members.module';
import { DatabaseModule } from '../database/database.module';
import { CompanyMembershipGuard } from './guards/company-membership.guard';
import { SupabaseAuthGuard } from './guards/supabase-auth.guard';

@Module({
  imports: [DatabaseModule, CompanyMembersModule],
  providers: [SupabaseAuthGuard, CompanyMembershipGuard],
  exports: [SupabaseAuthGuard, CompanyMembershipGuard, CompanyMembersModule],
})
export class AuthModule {}
