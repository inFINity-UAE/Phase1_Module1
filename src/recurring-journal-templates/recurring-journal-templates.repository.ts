import { CreateRecurringJournalTemplateDto } from './dto/create-recurring-journal-template.dto';
import { UpdateRecurringJournalTemplateDto } from './dto/update-recurring-journal-template.dto';
import { CreateRecurringJournalTemplateLineDto } from './dto/create-recurring-journal-template-line.dto';
import { UpdateRecurringJournalTemplateLineDto } from './dto/update-recurring-journal-template-line.dto';
import { AccountingPeriod } from '../accounting-periods/entities/accounting-period.entity';
import { RecurringJournalTemplate } from './entities/recurring-journal-template.entity';
import { RecurringJournalTemplateLine } from './entities/recurring-journal-template-line.entity';
import { RecurringJournalTemplateWithLines } from './entities/recurring-journal-template-with-lines.entity';

export const RECURRING_JOURNAL_TEMPLATES_REPOSITORY = Symbol(
  'RECURRING_JOURNAL_TEMPLATES_REPOSITORY',
);

export type CreateRecurringJournalTemplateWithActor = CreateRecurringJournalTemplateDto & {
  created_by: string;
};

export interface RecurringJournalTemplatesRepository {
  insert(dto: CreateRecurringJournalTemplateWithActor): Promise<RecurringJournalTemplateWithLines>;
  findAll(companyId?: string): Promise<RecurringJournalTemplateWithLines[]>;
  findByIdWithLines(id: string): Promise<RecurringJournalTemplateWithLines | null>;
  update(
    id: string,
    dto: UpdateRecurringJournalTemplateDto,
  ): Promise<RecurringJournalTemplate>;
  delete(id: string): Promise<void>;
  insertLine(
    templateId: string,
    dto: CreateRecurringJournalTemplateLineDto,
  ): Promise<RecurringJournalTemplateLine>;
  updateLine(
    id: string,
    dto: UpdateRecurringJournalTemplateLineDto,
  ): Promise<RecurringJournalTemplateLine>;
  deleteLine(id: string): Promise<void>;
  findDueTemplates(
    asOfDate: string,
    companyId: string,
  ): Promise<RecurringJournalTemplateWithLines[]>;
  /**
   * [feature-spec.md decision #62] Company ids that have at least one
   * active recurring template — scheduled runner iterates these.
   */
  listCompanyIdsWithActiveTemplates(): Promise<string[]>;
  findOpenPeriodForDate(
    companyId: string,
    date: string,
  ): Promise<AccountingPeriod | null>;
  updateSchedule(
    id: string,
    nextRunDate: string,
    isActive: boolean,
  ): Promise<RecurringJournalTemplate>;
}
