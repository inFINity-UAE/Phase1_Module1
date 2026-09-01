import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { UpdateCreditNoteDto } from './dto/update-credit-note.dto';
import { VoidCreditNoteDto } from './dto/void-credit-note.dto';
import { CreditNotesService } from './credit-notes.service';

/** [feature-spec-1.1.C.md §1.4] Credit note header CRUD + status transitions. */
@Controller('credit-notes')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class CreditNotesController {
  constructor(private readonly creditNotesService: CreditNotesService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body' })
  create(@Body() dto: CreateCreditNoteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.creditNotesService.create(dto, user.id);
  }

  @Get()
  @RequireCompanyMembership({ type: 'query' })
  findAll(@Query('company_id') companyId: string) {
    return this.creditNotesService.findAll(companyId);
  }

  @Get(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'credit_note' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.creditNotesService.findOne(id);
  }

  @Patch(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'credit_note' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCreditNoteDto) {
    return this.creditNotesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCompanyMembership({ type: 'param', resource: 'credit_note' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.creditNotesService.remove(id);
  }

  @Post(':id/issue')
  @RequireCompanyMembership({ type: 'param', resource: 'credit_note' })
  issue(@Param('id', ParseUUIDPipe) id: string) {
    return this.creditNotesService.issue(id);
  }

  @Post(':id/void')
  @RequireCompanyMembership({ type: 'param', resource: 'credit_note' })
  void(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidCreditNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.creditNotesService.void(id, dto, user.id);
  }
}
