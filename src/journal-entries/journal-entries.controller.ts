import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { JournalEntriesService } from './journal-entries.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';
import { CreateYearEndClosingDto } from './dto/create-year-end-closing.dto';
import { AccrueUnbilledReceiptsDto } from './dto/accrue-unbilled-receipts.dto';
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto';
import {
  ApproveJournalEntryDto,
  PostJournalEntryDto,
  RejectJournalEntryDto,
} from './dto/journal-entry-approval.dto';

/**
 * [feature-spec.md decisions #24/#31/#41] Session + company membership on every
 * route. Post/approve/reject reuse CompanyMembershipGuard's resolved role
 * (no second membership lookup) for Owner/Manager checks (#10/#11).
 */
@Controller('journal-entries')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class JournalEntriesController {
  constructor(private readonly journalEntriesService: JournalEntriesService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body' })
  create(@Body() dto: CreateJournalEntryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.journalEntriesService.create(dto, user.id);
  }

  @Post('opening-balance')
  @RequireCompanyMembership({ type: 'body' })
  createOpeningBalance(
    @Body() dto: CreateOpeningBalanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journalEntriesService.createOpeningBalance(dto, user.id);
  }

  @Post('year-end-close')
  @RequireCompanyMembership({ type: 'body' })
  runYearEndClosing(
    @Body() dto: CreateYearEndClosingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journalEntriesService.runYearEndClosing(dto, user.id, user.role);
  }

  /**
   * [feature-spec-1_1_E.md E-21 / §5.5] Static path before `:id` routes.
   * Manual GRNI accrual — not a second scheduler.
   */
  @Post('accrue-unbilled-receipts')
  @RequireCompanyMembership({ type: 'body' })
  accrueUnbilledReceipts(
    @Body() dto: AccrueUnbilledReceiptsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journalEntriesService.accrueUnbilledReceipts(dto, user.id);
  }

  /**
   * [feature-spec.md decision #31/#41] Required company_id; membership enforced.
   */
  @Get()
  @RequireCompanyMembership({ type: 'query' })
  findAll(
    @Query('company_id') companyId: string,
    @Query('status') status?: string,
    @Query('period_id') periodId?: string,
  ) {
    return this.journalEntriesService.findAll(companyId, {
      ...(status !== undefined ? { status } : {}),
      ...(periodId !== undefined ? { period_id: periodId } : {}),
    });
  }

  @Get(':id/attachments')
  @RequireCompanyMembership({ type: 'param', resource: 'journal_entry' })
  getAttachments(@Param('id', ParseUUIDPipe) id: string) {
    return this.journalEntriesService.getAttachments(id);
  }

  @Get(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'journal_entry' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.journalEntriesService.findOne(id);
  }

  @Post(':id/post')
  @RequireCompanyMembership({ type: 'param', resource: 'journal_entry' })
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PostJournalEntryDto,
  ) {
    return this.journalEntriesService.post(id, user.id, dto, user.role);
  }

  @Post(':id/approve')
  @RequireCompanyMembership({ type: 'param', resource: 'journal_entry' })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ApproveJournalEntryDto,
  ) {
    return this.journalEntriesService.approve(id, user.id, dto, user.role);
  }

  @Post(':id/reject')
  @RequireCompanyMembership({ type: 'param', resource: 'journal_entry' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RejectJournalEntryDto,
  ) {
    return this.journalEntriesService.reject(id, user.id, dto, user.role);
  }

  /**
   * [feature-spec decision #10/#41] created_by from session; membership from entry.
   */
  @Post(':id/reverse')
  @RequireCompanyMembership({ type: 'param', resource: 'journal_entry' })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journalEntriesService.reverse(id, user.id);
  }

  /**
   * [feature-spec.md #56/#41] Hard-delete; posted → 400 + audit delete_blocked.
   * Actor from session.
   */
  @Delete(':id')
  @HttpCode(204)
  @RequireCompanyMembership({ type: 'param', resource: 'journal_entry' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journalEntriesService.deleteEntry(id, user.id);
  }

  /**
   * [feature-spec.md decision #31/#41] Draft header update; membership from entry.
   */
  @Patch(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'journal_entry' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJournalEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journalEntriesService.update(id, dto, user.id);
  }
}
