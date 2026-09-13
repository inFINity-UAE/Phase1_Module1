import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { SuppliersController } from './suppliers.controller';
import { SUPPLIERS_REPOSITORY } from './suppliers.repository';
import { SupabaseSuppliersRepository } from './suppliers.repository.supabase';
import { SuppliersService } from './suppliers.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [SuppliersController],
  providers: [
    SuppliersService,
    {
      provide: SUPPLIERS_REPOSITORY,
      useClass: SupabaseSuppliersRepository,
    },
  ],
  exports: [SuppliersService, SUPPLIERS_REPOSITORY],
})
export class SuppliersModule {}
