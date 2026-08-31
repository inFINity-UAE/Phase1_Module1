import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CUSTOMERS_REPOSITORY } from './customers.repository';
import { SupabaseCustomersRepository } from './customers.repository.supabase';

@Module({
  imports: [AuthModule],
  controllers: [CustomersController],
  providers: [
    CustomersService,
    {
      provide: CUSTOMERS_REPOSITORY,
      useClass: SupabaseCustomersRepository,
    },
  ],
  exports: [CustomersService],
})
export class CustomersModule {}
