import { PartialType } from '@nestjs/mapped-types';
import { CreateRecurringJournalTemplateDto } from './create-recurring-journal-template.dto';

export class UpdateRecurringJournalTemplateDto extends PartialType(
  CreateRecurringJournalTemplateDto,
) {}
