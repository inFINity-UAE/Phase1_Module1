import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
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
 * [feature-spec.md decision #24] Session required on every route (incl. previously
 * unguarded GET/list/attachments/PATCH). Ledger-mutating routes keep the same
 * CurrentUser / JournalEntryCompanyRoleGuard wiring as before (#10/#11/#21).
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

  @Get()
  findAll() {
    return this.journalEntriesService.findAll();
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

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateJournalEntryDto) {
    return this.journalEntriesService.update(id, dto);
  }
}
