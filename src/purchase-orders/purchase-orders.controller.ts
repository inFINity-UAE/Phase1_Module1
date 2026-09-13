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
import { CreatePurchaseOrderLineDto } from './dto/create-purchase-order-line.dto';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderLineDto } from './dto/update-purchase-order-line.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { PurchaseOrdersService } from './purchase-orders.service';

/** [feature-spec-1_1_E.md §5.5] Purchase-order header + nested line CRUD. */
@Controller('purchase-orders')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body' })
  create(@Body() dto: CreatePurchaseOrderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.purchaseOrdersService.create(dto, user.id);
  }

  @Get()
  @RequireCompanyMembership({ type: 'query' })
  findAll(@Query('company_id') companyId: string) {
    return this.purchaseOrdersService.findAll(companyId);
  }

  @Get(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'purchase_order' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.purchaseOrdersService.findOne(id);
  }

  @Patch(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'purchase_order' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePurchaseOrderDto) {
    return this.purchaseOrdersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCompanyMembership({ type: 'param', resource: 'purchase_order' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.purchaseOrdersService.remove(id);
  }

  @Post(':id/lines')
  @RequireCompanyMembership({ type: 'param', resource: 'purchase_order' })
  createLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePurchaseOrderLineDto,
  ) {
    return this.purchaseOrdersService.createLine(id, dto);
  }

  @Patch(':id/lines/:lineId')
  @RequireCompanyMembership({ type: 'param', resource: 'purchase_order' })
  updateLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: UpdatePurchaseOrderLineDto,
  ) {
    return this.purchaseOrdersService.updateLine(id, lineId, dto);
  }

  @Delete(':id/lines/:lineId')
  @HttpCode(204)
  @RequireCompanyMembership({ type: 'param', resource: 'purchase_order' })
  removeLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ) {
    return this.purchaseOrdersService.deleteLine(id, lineId);
  }
}
