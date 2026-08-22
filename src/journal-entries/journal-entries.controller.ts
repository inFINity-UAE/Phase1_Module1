import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { JournalEntriesService } from './journal-entries.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';
import { CreateYearEndClosingDto } from './dto/create-year-end-closing.dto';
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto';
import { ReverseJournalEntryDto } from './dto/reverse-journal-entry.dto';
import {
  ApproveJournalEntryDto,
  PostJournalEntryDto,
  RejectJournalEntryDto,
} from './dto/journal-entry-approval.dto';

@Controller('journal-entries')
export class JournalEntriesController {
  constructor(private readonly journalEntriesService: JournalEntriesService) {}

  @Post()
  create(@Body() dto: CreateJournalEntryDto) {
    return this.journalEntriesService.create(dto);
  }

  @Post('opening-balance')
  createOpeningBalance(@Body() dto: CreateOpeningBalanceDto) {
    return this.journalEntriesService.createOpeningBalance(dto);
  }

  @Post('year-end-close')
  runYearEndClosing(@Body() dto: CreateYearEndClosingDto) {
    return this.journalEntriesService.runYearEndClosing(dto);
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
  post(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PostJournalEntryDto) {
    return this.journalEntriesService.post(id, dto);
  }

  @Post(':id/approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveJournalEntryDto,
  ) {
    return this.journalEntriesService.approve(id, dto);
  }

  @Post(':id/reject')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectJournalEntryDto,
  ) {
    return this.journalEntriesService.reject(id, dto);
  }

  @Post(':id/reverse')
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseJournalEntryDto,
  ) {
    return this.journalEntriesService.reverse(id, dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateJournalEntryDto) {
    return this.journalEntriesService.update(id, dto);
  }
}
