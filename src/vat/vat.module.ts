import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { BadDebtReliefClaimsController, VatVoluntaryDisclosuresController } from './vat-claims.controller';
import { CapitalGoodsItemsController, CapitalGoodsProjectsController } from './capital-goods.controller';
import { VatApportionmentController } from './vat-apportionment.controller';
import { VatReturnsController } from './vat-returns.controller';
import { VAT_REPOSITORY } from './vat.repository';
import { SupabaseVatRepository } from './vat.repository.supabase';
import { VatService } from './vat.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [
    VatReturnsController,
    VatApportionmentController,
    CapitalGoodsProjectsController,
    CapitalGoodsItemsController,
    BadDebtReliefClaimsController,
    VatVoluntaryDisclosuresController,
  ],
  providers: [VatService, { provide: VAT_REPOSITORY, useClass: SupabaseVatRepository }],
  exports: [VatService, VAT_REPOSITORY],
})
export class VatModule {}
