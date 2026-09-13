import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { GoodsReceiptsController } from './goods-receipts.controller';
import { GOODS_RECEIPTS_REPOSITORY } from './goods-receipts.repository';
import { SupabaseGoodsReceiptsRepository } from './goods-receipts.repository.supabase';
import { GoodsReceiptsService } from './goods-receipts.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [GoodsReceiptsController],
  providers: [
    GoodsReceiptsService,
    {
      provide: GOODS_RECEIPTS_REPOSITORY,
      useClass: SupabaseGoodsReceiptsRepository,
    },
  ],
  exports: [GoodsReceiptsService, GOODS_RECEIPTS_REPOSITORY],
})
export class GoodsReceiptsModule {}
