import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { JournalEntriesService } from './journal-entries.service';
import { CreateJournalLineDto } from './dto/create-journal-line.dto';
import { UpdateJournalLineDto } from './dto/update-journal-line.dto';

/**
 * [feature-spec.md decisions #27/#32/#34] Session required on every route —
 * controller-level SupabaseAuthGuard. Line DTOs carry no actor identity;
 * posted-line INSERT/UPDATE/DELETE rejected by prevent_posted_line_mutation
 * (P0001 → 400). createLine (#32), updateLine, deleteLine (#34) all routed.
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

  /**
   * [feature-spec.md decision #34] DELETE wires existing deleteLine —
   * posted parents blocked by trg_prevent_posted_line_update (#28).
   */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.journalEntriesService.deleteLine(id);
  }
}
