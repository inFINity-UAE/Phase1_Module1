import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  handleDatabaseError,
  isPostgrestError,
} from '../common/errors/database-error.mapper';
import { RecurrenceFrequency } from '../common/enums/recurrence-frequency.enum';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import {
  formatUnbalancedPostError,
  isJournalBalancePostRejection,
} from '../journal-entries/journal-entry-balance.util';
import {
  JOURNAL_ENTRIES_REPOSITORY,
  JournalEntriesRepository,
} from '../journal-entries/journal-entries.repository';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { CreateRecurringJournalTemplateDto } from './dto/create-recurring-journal-template.dto';
import { UpdateRecurringJournalTemplateDto } from './dto/update-recurring-journal-template.dto';
import { CreateRecurringJournalTemplateLineDto } from './dto/create-recurring-journal-template-line.dto';
import { UpdateRecurringJournalTemplateLineDto } from './dto/update-recurring-journal-template-line.dto';
import { RecurringGenerationResult } from './entities/recurring-generation-result.entity';
import { RecurringJournalTemplate } from './entities/recurring-journal-template.entity';
import { RecurringJournalTemplateLine } from './entities/recurring-journal-template-line.entity';
import { RecurringJournalTemplateWithLines } from './entities/recurring-journal-template-with-lines.entity';
import { advanceNextRunDate } from './recurring-run-date.util';
import {
  RECURRING_JOURNAL_TEMPLATES_REPOSITORY,
  RecurringJournalTemplatesRepository,
} from './recurring-journal-templates.repository';

@Injectable()
export class RecurringJournalTemplatesService {
  constructor(
    @Inject(RECURRING_JOURNAL_TEMPLATES_REPOSITORY)
    private readonly templatesRepository: RecurringJournalTemplatesRepository,
    @Inject(JOURNAL_ENTRIES_REPOSITORY)
    private readonly journalEntriesRepository: JournalEntriesRepository,
    private readonly journalEntriesService: JournalEntriesService,
  ) {}

  async create(
    dto: CreateRecurringJournalTemplateDto,
    createdBy: string,
  ): Promise<RecurringJournalTemplateWithLines> {
    if (!dto.lines?.length) {
      throw new BadRequestException('Recurring template must have at least one line');
    }

    try {
      return await this.templatesRepository.insert({ ...dto, created_by: createdBy });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findAll(companyId: string): Promise<RecurringJournalTemplateWithLines[]> {
    try {
      return await this.templatesRepository.findAll(companyId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findOne(id: string): Promise<RecurringJournalTemplateWithLines> {
    try {
      const result = await this.templatesRepository.findByIdWithLines(id);
      if (!result) {
        throw new NotFoundException(`Recurring journal template ${id} not found`);
      }
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      handleDatabaseError(error);
    }
  }

  async update(
    id: string,
    dto: UpdateRecurringJournalTemplateDto,
  ): Promise<RecurringJournalTemplate> {
    await this.findOne(id);
    try {
      return await this.templatesRepository.update(id, dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    try {
      await this.templatesRepository.delete(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async addLine(
    templateId: string,
    dto: CreateRecurringJournalTemplateLineDto,
  ): Promise<RecurringJournalTemplateLine> {
    await this.findOne(templateId);
    try {
      return await this.templatesRepository.insertLine(templateId, dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async updateLine(
    lineId: string,
    dto: UpdateRecurringJournalTemplateLineDto,
  ): Promise<RecurringJournalTemplateLine> {
    try {
      return await this.templatesRepository.updateLine(lineId, dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async removeLine(lineId: string): Promise<void> {
    try {
      await this.templatesRepository.deleteLine(lineId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec] Generation job for due recurring templates.
   * [Rules §1.3] auto_post=false → draft for review; auto_post=true → attempt post.
   * [feature-spec §4.1 decision #52] auto_post=true uses JournalEntriesService.post() —
   * it does not bypass approval thresholds or soft-close authorization.
   * [feature-spec.md decision #41] Scoped to one company_id — no cross-tenant batch.
   */
  async runDueGenerations(
    companyId: string,
    asOfDate?: string,
  ): Promise<RecurringGenerationResult[]> {
    const runDate = asOfDate ?? new Date().toISOString().slice(0, 10);

    try {
      const dueTemplates = await this.templatesRepository.findDueTemplates(
        runDate,
        companyId,
      );
      const results: RecurringGenerationResult[] = [];

      for (const templateWithLines of dueTemplates) {
        results.push(await this.generateFromTemplate(templateWithLines, runDate));
      }

      return results;
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async generateTemplate(id: string, asOfDate?: string): Promise<RecurringGenerationResult> {
    const templateWithLines = await this.findOne(id);
    const runDate = asOfDate ?? templateWithLines.template.next_run_date;
    return this.generateFromTemplate(templateWithLines, runDate);
  }

  private async generateFromTemplate(
    templateWithLines: RecurringJournalTemplateWithLines,
    runDate: string,
  ): Promise<RecurringGenerationResult> {
    const { template, lines } = templateWithLines;

    if (!template.is_active) {
      return {
        template_id: template.id,
        template_name: template.template_name,
        journal_entry: null,
        posted: false,
        next_run_date: template.next_run_date,
        error: `Template ${template.template_name} is not active`,
      };
    }

    if (template.next_run_date > runDate) {
      return {
        template_id: template.id,
        template_name: template.template_name,
        journal_entry: null,
        posted: false,
        next_run_date: template.next_run_date,
        error: `Template ${template.template_name} is not due until ${template.next_run_date}`,
      };
    }

    if (template.end_date && template.next_run_date > template.end_date) {
      return {
        template_id: template.id,
        template_name: template.template_name,
        journal_entry: null,
        posted: false,
        next_run_date: template.next_run_date,
        error: `Template ${template.template_name} has passed its end date`,
      };
    }

    if (!lines.length) {
      return {
        template_id: template.id,
        template_name: template.template_name,
        journal_entry: null,
        posted: false,
        next_run_date: template.next_run_date,
        error: `Template ${template.template_name} has no lines`,
      };
    }

    const period = await this.templatesRepository.findOpenPeriodForDate(
      template.company_id,
      template.next_run_date,
    );

    if (!period) {
      return {
        template_id: template.id,
        template_name: template.template_name,
        journal_entry: null,
        posted: false,
        next_run_date: template.next_run_date,
        error:
          `No open accounting period found for run date ${template.next_run_date} — ` +
          'generation skipped',
      };
    }

    let generated;

    try {
      generated = await this.journalEntriesRepository.insertGeneratedFromTemplate({
        company_id: template.company_id,
        period_id: period.id,
        entry_date: template.next_run_date,
        narration: template.narration_template,
        created_by: template.created_by,
        recurring_template_id: template.id,
        lines: lines.map((line) => ({
          line_number: line.line_number,
          account_id: line.account_id,
          debit: line.debit,
          credit: line.credit,
          description: line.description,
        })),
      });
    } catch (error) {
      handleDatabaseError(error);
    }

    let posted = false;
    let autoPostError: string | undefined;

    if (template.auto_post) {
      try {
        // [feature-spec §4.1 decision #52] Same post/approval path as manual entries.
        generated = await this.journalEntriesService.post(
          generated.entry.id,
          template.created_by,
        );
        posted = generated.entry.status === JournalEntryStatus.Posted;

        if (generated.entry.status === JournalEntryStatus.PendingApproval) {
          autoPostError =
            'Entry exceeds approval threshold and requires Owner approval before posting';
        }
      } catch (error) {
        if (this.isBalancePostFailure(error)) {
          await this.journalEntriesRepository.deleteEntry(generated.entry.id);

          const message =
            error instanceof BadRequestException &&
            typeof error.message === 'string' &&
            /must equal total credits/i.test(error.message)
              ? error.message
              : formatUnbalancedPostError(
                  generated.entry.entry_number,
                  generated.lines,
                );

          return {
            template_id: template.id,
            template_name: template.template_name,
            journal_entry: null,
            posted: false,
            next_run_date: template.next_run_date,
            error: message,
          };
        }

        if (error instanceof BadRequestException || error instanceof ForbiddenException) {
          autoPostError = error.message;
          generated =
            (await this.journalEntriesRepository.findByIdWithDetails(generated.entry.id)) ??
            generated;
        } else if (isPostgrestError(error)) {
          await this.journalEntriesRepository.deleteEntry(generated.entry.id);

          return {
            template_id: template.id,
            template_name: template.template_name,
            journal_entry: null,
            posted: false,
            next_run_date: template.next_run_date,
            error: error.message,
          };
        } else {
          handleDatabaseError(error);
        }
      }
    }

    const nextRunDate = advanceNextRunDate(
      template.next_run_date,
      template.frequency as RecurrenceFrequency,
      template.day_of_month,
    );
    const stillActive = !template.end_date || nextRunDate <= template.end_date;

    const updatedTemplate = await this.templatesRepository.updateSchedule(
      template.id,
      nextRunDate,
      stillActive,
    );

    return {
      template_id: template.id,
      template_name: template.template_name,
      journal_entry: generated,
      posted,
      next_run_date: updatedTemplate.next_run_date,
      error: autoPostError,
    };
  }

  /** [Rules §1.1] Balance rejection — discard generated draft and retry on next schedule run. */
  private isBalancePostFailure(error: unknown): boolean {
    if (
      isPostgrestError(error) &&
      error.code === 'P0001' &&
      isJournalBalancePostRejection(error.message)
    ) {
      return true;
    }

    if (error instanceof BadRequestException) {
      const message = typeof error.message === 'string' ? error.message : '';
      return (
        isJournalBalancePostRejection(message) ||
        (/must equal total credits/i.test(message) &&
          /Cannot post journal entry/i.test(message))
      );
    }

    return false;
  }
}
