import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { JournalEntriesService } from './journal-entries.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto';
import { ReverseJournalEntryDto } from './dto/reverse-journal-entry.dto';

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
  post(@Param('id', ParseUUIDPipe) id: string) {
    return this.journalEntriesService.post(id);
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
