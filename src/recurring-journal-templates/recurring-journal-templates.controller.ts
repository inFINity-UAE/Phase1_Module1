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
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { RecurringJournalTemplatesService } from './recurring-journal-templates.service';
import { CreateRecurringJournalTemplateDto } from './dto/create-recurring-journal-template.dto';
import { UpdateRecurringJournalTemplateDto } from './dto/update-recurring-journal-template.dto';
import { CreateRecurringJournalTemplateLineDto } from './dto/create-recurring-journal-template-line.dto';
import { UpdateRecurringJournalTemplateLineDto } from './dto/update-recurring-journal-template-line.dto';
import { RunRecurringGenerationDto } from './dto/run-recurring-generation.dto';

/**
 * [feature-spec.md decisions #24/#41] Session + membership on every route.
 * run-due is scoped to body.company_id (no cross-tenant batch).
 */
@Controller('recurring-journal-templates')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class RecurringJournalTemplatesController {
  constructor(private readonly templatesService: RecurringJournalTemplatesService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body' })
  create(
    @Body() dto: CreateRecurringJournalTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templatesService.create(dto, user.id);
  }

  @Post('run-due')
  @RequireCompanyMembership({ type: 'body' })
  runDue(@Body() dto: RunRecurringGenerationDto) {
    // company_id enforced by CompanyMembershipGuard (body) before this runs
    return this.templatesService.runDueGenerations(dto.company_id!, dto.as_of_date);
  }

  @Get()
  @RequireCompanyMembership({ type: 'query' })
  findAll(@Query('company_id') companyId: string) {
    return this.templatesService.findAll(companyId);
  }

  @Get(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'recurring_template' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.templatesService.findOne(id);
  }

  @Patch(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'recurring_template' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecurringJournalTemplateDto,
  ) {
    return this.templatesService.update(id, dto);
  }

  @Delete(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'recurring_template' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.templatesService.remove(id);
  }

  @Post(':id/lines')
  @RequireCompanyMembership({ type: 'param', resource: 'recurring_template' })
  addLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRecurringJournalTemplateLineDto,
  ) {
    return this.templatesService.addLine(id, dto);
  }

  @Post(':id/generate')
  @RequireCompanyMembership({ type: 'param', resource: 'recurring_template' })
  generate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RunRecurringGenerationDto,
  ) {
    return this.templatesService.generateTemplate(id, dto.as_of_date);
  }
}

/**
 * [feature-spec.md decisions #24/#41] Line mutations require session + membership
 * via parent template.
 */
@Controller('recurring-journal-template-lines')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class RecurringJournalTemplateLinesController {
  constructor(private readonly templatesService: RecurringJournalTemplatesService) {}

  @Patch(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'recurring_template_line' })
  updateLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecurringJournalTemplateLineDto,
  ) {
    return this.templatesService.updateLine(id, dto);
  }

  @Delete(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'recurring_template_line' })
  removeLine(@Param('id', ParseUUIDPipe) id: string) {
    return this.templatesService.removeLine(id);
  }
}
