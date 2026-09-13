import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CreateGoodsReceiptLineDto } from './dto/create-goods-receipt-line.dto';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { UpdateGoodsReceiptLineDto } from './dto/update-goods-receipt-line.dto';
import { UpdateGoodsReceiptDto } from './dto/update-goods-receipt.dto';
import { GoodsReceiptsService } from './goods-receipts.service';

/** [feature-spec-1_1_E.md §5.5] Goods-receipt header + nested line CRUD. */
@Controller('goods-receipts')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class GoodsReceiptsController {
  constructor(private readonly goodsReceiptsService: GoodsReceiptsService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body' })
  create(@Body() dto: CreateGoodsReceiptDto, @CurrentUser() user: AuthenticatedUser) {
    return this.goodsReceiptsService.create(dto, user.id);
  }

  @Get()
  @RequireCompanyMembership({ type: 'query' })
  findAll(@Query('company_id') companyId: string) {
    return this.goodsReceiptsService.findAll(companyId);
  }

  @Get(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'goods_receipt' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.goodsReceiptsService.findOne(id);
  }

  @Patch(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'goods_receipt' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGoodsReceiptDto) {
    return this.goodsReceiptsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCompanyMembership({ type: 'param', resource: 'goods_receipt' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.goodsReceiptsService.remove(id);
  }

  @Post(':id/lines')
  @RequireCompanyMembership({ type: 'param', resource: 'goods_receipt' })
  createLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateGoodsReceiptLineDto,
  ) {
    return this.goodsReceiptsService.createLine(id, dto);
  }

  @Patch(':id/lines/:lineId')
  @RequireCompanyMembership({ type: 'param', resource: 'goods_receipt' })
  updateLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: UpdateGoodsReceiptLineDto,
  ) {
    return this.goodsReceiptsService.updateLine(id, lineId, dto);
  }

  @Delete(':id/lines/:lineId')
  @HttpCode(204)
  @RequireCompanyMembership({ type: 'param', resource: 'goods_receipt' })
  removeLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ) {
    return this.goodsReceiptsService.deleteLine(id, lineId);
  }
}
