import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { RecurringJournalTemplatesService } from './recurring-journal-templates.service';
import { CreateRecurringJournalTemplateDto } from './dto/create-recurring-journal-template.dto';
import { UpdateRecurringJournalTemplateDto } from './dto/update-recurring-journal-template.dto';
import { CreateRecurringJournalTemplateLineDto } from './dto/create-recurring-journal-template-line.dto';
import { UpdateRecurringJournalTemplateLineDto } from './dto/update-recurring-journal-template-line.dto';
import { RunRecurringGenerationDto } from './dto/run-recurring-generation.dto';

/**
 * [feature-spec.md decision #24] Every route requires an authenticated session —
 * controller-level guard (same pattern as decision #21). Create already derives
 * created_by from @CurrentUser(); no client identity fields on DTOs.
 */
@Controller('recurring-journal-templates')
@UseGuards(SupabaseAuthGuard)
export class RecurringJournalTemplatesController {
  constructor(private readonly templatesService: RecurringJournalTemplatesService) {}

  @Post()
  create(
    @Body() dto: CreateRecurringJournalTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templatesService.create(dto, user.id);
  }

  @Post('run-due')
  runDue(@Body() dto: RunRecurringGenerationDto) {
    return this.templatesService.runDueGenerations(dto.as_of_date);
  }

  @Get()
  findAll(@Query('company_id') companyId?: string) {
    return this.templatesService.findAll(companyId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.templatesService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecurringJournalTemplateDto,
  ) {
    return this.templatesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.templatesService.remove(id);
  }

  @Post(':id/lines')
  addLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRecurringJournalTemplateLineDto,
  ) {
    return this.templatesService.addLine(id, dto);
  }

  @Post(':id/generate')
  generate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RunRecurringGenerationDto,
  ) {
    return this.templatesService.generateTemplate(id, dto.as_of_date);
  }
}

/**
 * [feature-spec.md decision #24] Line mutations also require a session.
 */
@Controller('recurring-journal-template-lines')
@UseGuards(SupabaseAuthGuard)
export class RecurringJournalTemplateLinesController {
  constructor(private readonly templatesService: RecurringJournalTemplatesService) {}

  @Patch(':id')
  updateLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecurringJournalTemplateLineDto,
  ) {
    return this.templatesService.updateLine(id, dto);
  }

  @Delete(':id')
  removeLine(@Param('id', ParseUUIDPipe) id: string) {
    return this.templatesService.removeLine(id);
  }
}
