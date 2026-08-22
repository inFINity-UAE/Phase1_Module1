import { PartialType } from '@nestjs/mapped-types';
import { CreateRecurringJournalTemplateLineDto } from './create-recurring-journal-template-line.dto';

export class UpdateRecurringJournalTemplateLineDto extends PartialType(
  CreateRecurringJournalTemplateLineDto,
) {}
