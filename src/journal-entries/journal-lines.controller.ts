import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { JournalEntriesService } from './journal-entries.service';
import { CreateJournalLineDto } from './dto/create-journal-line.dto';
import { UpdateJournalLineDto } from './dto/update-journal-line.dto';

/**
 * [feature-spec.md decisions #27/#32/#34/#41] Session + membership: create
 * resolves company via body.journal_entry_id; update/delete via line → parent.
 */
@Controller('journal-lines')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class JournalLinesController {
  constructor(private readonly journalEntriesService: JournalEntriesService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body_ref', resource: 'journal_entry', field: 'journal_entry_id' })
  create(@Body() dto: CreateJournalLineDto) {
    return this.journalEntriesService.createLine(dto);
  }

  @Patch(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'journal_line' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateJournalLineDto) {
    return this.journalEntriesService.updateLine(id, dto);
  }

  /**
   * [feature-spec.md decision #34/#41] DELETE wires existing deleteLine —
   * posted parents blocked by trg_prevent_posted_line_update (#28).
   */
  @Delete(':id')
  @HttpCode(204)
  @RequireCompanyMembership({ type: 'param', resource: 'journal_line' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.journalEntriesService.deleteLine(id);
  }
}
