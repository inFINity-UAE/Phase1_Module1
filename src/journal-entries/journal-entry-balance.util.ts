import { JournalLine } from './entities/journal-line.entity';

function sumAmount(lines: JournalLine[], field: 'debit' | 'credit'): number {
  return lines.reduce((total, line) => total + Number(line[field]), 0);
}

/** [Rules §1.1] Human-readable imbalance detail for post rejection. */
export function formatUnbalancedPostError(
  entryNumber: number,
  lines: JournalLine[],
): string {
  const totalDebit = sumAmount(lines, 'debit');
  const totalCredit = sumAmount(lines, 'credit');
  const difference = Math.abs(totalDebit - totalCredit);
  const lineDetails = lines
    .map(
      (line) =>
        `line ${line.line_number}: debit ${Number(line.debit).toFixed(2)}, credit ${Number(line.credit).toFixed(2)}`,
    )
    .join('; ');

  return (
    `Cannot post journal entry ${entryNumber}: total debits (${totalDebit.toFixed(2)}) ` +
    `must equal total credits (${totalCredit.toFixed(2)}) per Rules §1.1 — ` +
    `difference ${difference.toFixed(2)}. ${lineDetails}.`
  );
}

export function isJournalBalancePostRejection(message: string): boolean {
  return /unbalanced/i.test(message) && /post/i.test(message);
}

/** Entry materiality total for approval threshold — sum of debit lines. */
export function computeEntryTotal(lines: JournalLine[]): number {
  return sumAmount(lines, 'debit');
}
