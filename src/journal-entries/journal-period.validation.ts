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
  if (!periodId) {
    return;
  }

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
