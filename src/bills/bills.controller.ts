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
import { BillsService } from './bills.service';
import { BillStatus } from './common/enums/bill-status.enum';
import { CreateBillLineDto } from './dto/create-bill-line.dto';
import { CreateBillDto } from './dto/create-bill.dto';
import { DisputeBillDto } from './dto/dispute-bill.dto';
import { OverrideMatchBlockDto } from './dto/override-match-block.dto';
import { ScheduleBillDto } from './dto/schedule-bill.dto';
import { UpdateBillLineDto } from './dto/update-bill-line.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { VoidBillDto } from './dto/void-bill.dto';

/** [feature-spec-1_1_E.md §5.5] Bill CRUD, match, issue, approve, void. */
@Controller('bills')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body' })
  create(@Body() dto: CreateBillDto, @CurrentUser() user: AuthenticatedUser) {
    return this.billsService.create(dto, user.id);
  }

  @Get()
  @RequireCompanyMembership({ type: 'query' })
  findAll(@Query('company_id') companyId: string, @Query('status') status?: BillStatus) {
    return this.billsService.findAll(companyId, status);
  }

  @Get(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'bill' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.billsService.findOne(id);
  }

  @Patch(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'bill' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBillDto) {
    return this.billsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCompanyMembership({ type: 'param', resource: 'bill' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.billsService.remove(id);
  }

  @Post(':id/match')
  @RequireCompanyMembership({ type: 'param', resource: 'bill' })
  match(@Param('id', ParseUUIDPipe) id: string) {
    return this.billsService.match(id);
  }

  @Post(':id/issue')
  @RequireCompanyMembership({ type: 'param', resource: 'bill' })
  issue(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.billsService.issue(id, user.id, user.role);
  }

  @Post(':id/approve')
  @RequireCompanyMembership({ type: 'param', resource: 'bill' })
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.billsService.approve(id, user.id, user.role);
  }

  @Post(':id/override-match-block')
  @RequireCompanyMembership({ type: 'param', resource: 'bill' })
  overrideMatchBlock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OverrideMatchBlockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.billsService.overrideMatchBlock(id, dto, user.id, user.role);
  }

  @Post(':id/void')
  @RequireCompanyMembership({ type: 'param', resource: 'bill' })
  void(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidBillDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.billsService.void(id, dto, user.id);
  }

  @Patch(':id/schedule')
  @RequireCompanyMembership({ type: 'param', resource: 'bill' })
  schedule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ScheduleBillDto) {
    return this.billsService.schedule(id, dto);
  }

  @Patch(':id/dispute')
  @RequireCompanyMembership({ type: 'param', resource: 'bill' })
  dispute(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DisputeBillDto) {
    return this.billsService.dispute(id, dto);
  }

  @Post(':id/lines')
  @RequireCompanyMembership({ type: 'param', resource: 'bill' })
  createLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBillLineDto,
  ) {
    return this.billsService.createLine(id, dto);
  }

  @Patch(':id/lines/:lineId')
  @RequireCompanyMembership({ type: 'param', resource: 'bill' })
  updateLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: UpdateBillLineDto,
  ) {
    return this.billsService.updateLine(id, lineId, dto);
  }

  @Delete(':id/lines/:lineId')
  @HttpCode(204)
  @RequireCompanyMembership({ type: 'param', resource: 'bill' })
  removeLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ) {
    return this.billsService.deleteLine(id, lineId);
  }
}
