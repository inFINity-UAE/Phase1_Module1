import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { ACCOUNTS_REPOSITORY } from './accounts.repository';
import { SupabaseAccountsRepository } from './accounts.repository.supabase';

@Module({
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
