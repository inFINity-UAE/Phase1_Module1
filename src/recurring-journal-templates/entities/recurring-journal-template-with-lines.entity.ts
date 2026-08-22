import { RecurringJournalTemplate } from './recurring-journal-template.entity';
import { RecurringJournalTemplateLine } from './recurring-journal-template-line.entity';

export class RecurringJournalTemplateWithLines {
  template!: RecurringJournalTemplate;
  lines!: RecurringJournalTemplateLine[];
}
