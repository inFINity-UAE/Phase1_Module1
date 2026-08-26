import { Body, Controller, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { JournalEntriesService } from './journal-entries.service';
import { CreateJournalLineDto } from './dto/create-journal-line.dto';
import { UpdateJournalLineDto } from './dto/update-journal-line.dto';

/**
 * [feature-spec.md decision #27] Session required on every route — controller-level
 * guard (same pattern as decisions #21 / #24). Line DTOs carry no actor identity;
 * posted-line mutations are rejected by prevent_posted_line_mutation (P0001 → 400).
 */
@Controller('journal-lines')
@UseGuards(SupabaseAuthGuard)
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
