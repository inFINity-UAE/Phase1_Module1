import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JournalEntryCompanyRoleGuard } from '../auth/guards/journal-entry-company-role.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { JournalEntriesService } from './journal-entries.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';
import { CreateYearEndClosingDto } from './dto/create-year-end-closing.dto';
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto';
import {
  ApproveJournalEntryDto,
  PostJournalEntryDto,
  RejectJournalEntryDto,
} from './dto/journal-entry-approval.dto';

/**
 * [feature-spec.md decisions #24/#31] Session required on every route (incl. list
 * and header PATCH). Ledger-mutating routes keep CurrentUser /
 * JournalEntryCompanyRoleGuard wiring (#10/#11/#21).
 */
@Controller('journal-entries')
@UseGuards(SupabaseAuthGuard)
export class JournalEntriesController {
  constructor(private readonly journalEntriesService: JournalEntriesService) {}

  @Post()
  create(@Body() dto: CreateJournalEntryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.journalEntriesService.create(dto, user.id);
  }

  @Post('opening-balance')
  createOpeningBalance(
    @Body() dto: CreateOpeningBalanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journalEntriesService.createOpeningBalance(dto, user.id);
  }

  @Post('year-end-close')
  runYearEndClosing(
    @Body() dto: CreateYearEndClosingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journalEntriesService.runYearEndClosing(dto, user.id);
  }

  /**
   * [feature-spec.md decision #31] Required company_id; optional status / period_id.
   */
  @Get()
  findAll(
    @Query('company_id') companyId?: string,
    @Query('status') status?: string,
    @Query('period_id') periodId?: string,
  ) {
    return this.journalEntriesService.findAll(companyId ?? '', {
      ...(status !== undefined ? { status } : {}),
      ...(periodId !== undefined ? { period_id: periodId } : {}),
    });
  }

  @Get(':id/attachments')
  getAttachments(@Param('id', ParseUUIDPipe) id: string) {
    return this.journalEntriesService.getAttachments(id);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.journalEntriesService.findOne(id);
  }

  @Post(':id/post')
  @UseGuards(JournalEntryCompanyRoleGuard)
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PostJournalEntryDto,
  ) {
    return this.journalEntriesService.post(id, user.id, dto);
  }

  @Post(':id/approve')
  @UseGuards(JournalEntryCompanyRoleGuard)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ApproveJournalEntryDto,
  ) {
    return this.journalEntriesService.approve(id, user.id, dto);
  }

  @Post(':id/reject')
  @UseGuards(JournalEntryCompanyRoleGuard)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RejectJournalEntryDto,
  ) {
    return this.journalEntriesService.reject(id, user.id, dto);
  }

  /**
   * [feature-spec decision #10] created_by for the reversal RPC is the
   * authenticated session user — never a client body field.
   */
  @Post(':id/reverse')
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journalEntriesService.reverse(id, user.id);
  }

  /**
   * [feature-spec.md decision #31] Draft header update. uploaded_by for any
   * replacement attachments comes from the session — never the body.
   */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJournalEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journalEntriesService.update(id, dto, user.id);
  }
}
