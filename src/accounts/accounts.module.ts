import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { ACCOUNTS_REPOSITORY } from './accounts.repository';
import { SupabaseAccountsRepository } from './accounts.repository.supabase';

@Module({
  imports: [AuthModule],
  controllers: [AccountsController],
  providers: [
    AccountsService,
    {
      provide: ACCOUNTS_REPOSITORY,
      useClass: SupabaseAccountsRepository,
    },
  ],
})
export class AccountsModule {}
