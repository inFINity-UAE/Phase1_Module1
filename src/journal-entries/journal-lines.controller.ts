import { Body, Controller, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { JournalEntriesService } from './journal-entries.service';
import { CreateJournalLineDto } from './dto/create-journal-line.dto';
import { UpdateJournalLineDto } from './dto/update-journal-line.dto';

@Controller('journal-lines')
export class JournalLinesController {
  constructor(private readonly journalEntriesService: JournalEntriesService) {}

  @Post()
  create(@Body() dto: CreateJournalLineDto) {
    return this.journalEntriesService.createLine(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateJournalLineDto) {
    return this.journalEntriesService.updateLine(id, dto);
  }
}
