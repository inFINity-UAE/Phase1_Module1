import { Body, Controller, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { JournalEntriesService } from './journal-entries.service';
import { CreateJournalLineDto } from './dto/create-journal-line.dto';
import { UpdateJournalLineDto } from './dto/update-journal-line.dto';

/**
 * [feature-spec.md decisions #27/#32] Session required on every route —
 * controller-level SupabaseAuthGuard. Line DTOs carry no actor identity;
 * posted-line INSERT/UPDATE/DELETE rejected by prevent_posted_line_mutation
 * (P0001 → 400). createLine implemented (#32); updateLine already built;
 * deleteLine exists on the service but has no DELETE route here.
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
