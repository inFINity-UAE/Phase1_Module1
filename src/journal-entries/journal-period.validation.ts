import { BadRequestException } from '@nestjs/common';

/**
 * [feature-spec.md §7.26 finding #1 / decision #51] Shared period_id checks for
 * client-supplied periods on draft journal entry creates (insertDraft,
 * insertGeneratedFromTemplate via insert_journal_entry_draft RPC).
 */
export type JournalEntryPeriodRow = {
  id: string;
  company_id: string;
  period_start?: string | null;
  period_end?: string | null;
};

export function assertPeriodUsableForCompany(
  companyId: string,
  periodId: string,
  period: JournalEntryPeriodRow | null | undefined,
): void {
  if (!periodId) return;

  if (!period) {
    throw new BadRequestException(
      `Accounting period ${periodId} was not found — cannot create a journal entry against a missing period`,
    );
  }

  if (period.company_id !== companyId) {
    const range =
      period.period_start && period.period_end
        ? `${period.period_start} to ${period.period_end}`
        : periodId;
    throw new BadRequestException(
      `Accounting period ${range} belongs to a different company than the journal entry`,
    );
  }
}

/** [§7.30 audit] entry_date must fall within the linked period's date range. */
export function assertEntryDateWithinPeriod(
  entryDate: string,
  period: Pick<JournalEntryPeriodRow, 'period_start' | 'period_end'> | null | undefined,
): void {
  if (!period?.period_start || !period?.period_end) return;

  if (entryDate < period.period_start || entryDate > period.period_end) {
    throw new BadRequestException(
      `Entry date ${entryDate} must fall within accounting period ${period.period_start} to ${period.period_end}`,
    );
  }
}

export type RecurringTemplateCompanyRow = {
  id: string;
  company_id: string;
};

/** [§7.30 audit] recurring_template_id must belong to the entry company. */
export function assertRecurringTemplateUsableForCompany(
  companyId: string,
  templateId: string,
  template: RecurringTemplateCompanyRow | null | undefined,
): void {
  if (!templateId) return;

  if (!template) {
    throw new BadRequestException(
      `Recurring journal template ${templateId} was not found — cannot link a journal entry to a missing template`,
    );
  }

  if (template.company_id !== companyId) {
    throw new BadRequestException(
      `Recurring journal template ${templateId} belongs to a different company than the journal entry`,
    );
  }
}
