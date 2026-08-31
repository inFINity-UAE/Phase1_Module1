import { InvoiceLine } from './invoice-line.entity';
import { Invoice } from './invoice.entity';

export class InvoiceWithLines {
  invoice!: Invoice;
  lines!: InvoiceLine[];
}

/** Issue response — ledger posting explicitly deferred (C1-3 / Batch 2). */
export class InvoiceIssueResult extends InvoiceWithLines {
  /** Always null until Batch 2 §7 wires create_invoice_journal_entry. */
  journal_entry_id!: null;
  ledger_posting_status!: 'deferred_batch_2';
}
