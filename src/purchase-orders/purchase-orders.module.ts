import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PURCHASE_ORDERS_REPOSITORY } from './purchase-orders.repository';
import { SupabasePurchaseOrdersRepository } from './purchase-orders.repository.supabase';
import { PurchaseOrdersService } from './purchase-orders.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [PurchaseOrdersController],
  providers: [
    PurchaseOrdersService,
    {
      provide: PURCHASE_ORDERS_REPOSITORY,
      useClass: SupabasePurchaseOrdersRepository,
    },
  ],
  exports: [PurchaseOrdersService, PURCHASE_ORDERS_REPOSITORY],
})
export class PurchaseOrdersModule {}
