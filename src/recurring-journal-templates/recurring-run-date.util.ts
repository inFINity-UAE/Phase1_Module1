import { RecurrenceFrequency } from '../common/enums/recurrence-frequency.enum';

function parseDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Advance next_run_date after a successful generation run. */
export function advanceNextRunDate(
  currentRunDate: string,
  frequency: RecurrenceFrequency,
  dayOfMonth?: number | null,
): string {
  const date = parseDate(currentRunDate);

  switch (frequency) {
    case RecurrenceFrequency.Daily:
      date.setUTCDate(date.getUTCDate() + 1);
      break;
    case RecurrenceFrequency.Weekly:
      date.setUTCDate(date.getUTCDate() + 7);
      break;
    case RecurrenceFrequency.Monthly: {
      const day = date.getUTCDate();
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() + 1);
      const lastDay = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
      ).getUTCDate();
      const targetDay = dayOfMonth != null ? dayOfMonth : day;
      date.setUTCDate(Math.min(targetDay, lastDay));
      break;
    }
    case RecurrenceFrequency.Quarterly:
      date.setUTCMonth(date.getUTCMonth() + 3);
      break;
    case RecurrenceFrequency.Annually:
      date.setUTCFullYear(date.getUTCFullYear() + 1);
      break;
  }

  return formatDate(date);
}
