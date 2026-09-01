import { CreditNoteLine } from './credit-note-line.entity';
import { CreditNote } from './credit-note.entity';

export class CreditNoteWithLines {
  credit_note!: CreditNote;
  lines!: CreditNoteLine[];
}

/** Issue response — ledger posting explicitly deferred (C1-4 / Batch 2). */
export class CreditNoteIssueResult extends CreditNoteWithLines {
  /** Always null until Batch 2 §7 wires credit-note posting. */
  journal_entry_id!: null;
  ledger_posting_status!: 'deferred_batch_2';
}
