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
import { AdjustCapitalGoodsItemDto, CreateCapitalGoodsItemDto, CreateCapitalGoodsProjectDto } from './dto/vat.dto';
import { VatService } from './vat.service';

/** [feature-spec-1_1_F.md F-40] */
@Controller('capital-goods-projects')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class CapitalGoodsProjectsController {
  constructor(private readonly vatService: VatService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body' })
  create(@Body() dto: CreateCapitalGoodsProjectDto, @CurrentUser() user: AuthenticatedUser) {
    return this.vatService.createProject(dto, user.id);
  }

  @Get()
  @RequireCompanyMembership({ type: 'query' })
  findAll(@Query('company_id') companyId: string) {
    return this.vatService.listProjects(companyId);
  }

  @Get(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'capital_goods_project' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.vatService.findProject(id);
  }

  @Patch(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'capital_goods_project' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: Record<string, unknown>) {
    return this.vatService.updateProject(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCompanyMembership({ type: 'param', resource: 'capital_goods_project' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.vatService.deleteProject(id);
  }
}

/** [feature-spec-1_1_F.md F-5 / F-40] */
@Controller('capital-goods-items')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class CapitalGoodsItemsController {
  constructor(private readonly vatService: VatService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body' })
  create(@Body() dto: CreateCapitalGoodsItemDto, @CurrentUser() user: AuthenticatedUser) {
    return this.vatService.createItem(dto, user.id);
  }

  @Get()
  @RequireCompanyMembership({ type: 'query' })
  findAll(@Query('company_id') companyId: string) {
    return this.vatService.listItems(companyId);
  }

  @Get(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'capital_goods_item' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.vatService.findItem(id);
  }

  @Patch(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'capital_goods_item' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: Record<string, unknown>) {
    return this.vatService.updateItem(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCompanyMembership({ type: 'param', resource: 'capital_goods_item' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.vatService.deleteItem(id);
  }

  @Post(':id/adjust')
  @RequireCompanyMembership({ type: 'param', resource: 'capital_goods_item' })
  adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustCapitalGoodsItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vatService.adjustItem(id, dto, user.id);
  }
}
