import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CreateCreditNoteLineRequestDto } from './dto/create-credit-note-line-request.dto';
import { UpdateCreditNoteLineDto } from './dto/update-credit-note-line.dto';
import { CreditNotesService } from './credit-notes.service';

/** [feature-spec-1_1_C.md §1.4] Credit note line CRUD while parent is draft. */
@Controller('credit-note-lines')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class CreditNoteLinesController {
  constructor(private readonly creditNotesService: CreditNotesService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body_ref', resource: 'credit_note', field: 'credit_note_id' })
  create(@Body() dto: CreateCreditNoteLineRequestDto) {
    return this.creditNotesService.createLine(dto);
  }

  @Patch(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'credit_note_line' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCreditNoteLineDto) {
    return this.creditNotesService.updateLine(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCompanyMembership({ type: 'param', resource: 'credit_note_line' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.creditNotesService.deleteLine(id);
  }
}
