import { CreditNoteLine } from './credit-note-line.entity';
import { CreditNote } from './credit-note.entity';

export class CreditNoteWithLines {
  credit_note!: CreditNote;
  lines!: CreditNoteLine[];
}

/** Issue response — includes posted credit-note journal entry on the credit note row. */
export type CreditNoteIssueResult = CreditNoteWithLines;

/** Void response — includes ledger reversal outcome when B2 posting exists. */
export type CreditNoteVoidResult = CreditNoteWithLines & {
  ledger_reversal_status: 'reversed' | 'skipped_no_posting';
};
