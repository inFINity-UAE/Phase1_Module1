import { InvoiceLine } from './invoice-line.entity';
import { Invoice } from './invoice.entity';

export class InvoiceWithLines {
  invoice!: Invoice;
  lines!: InvoiceLine[];
}

/** Issue response — includes posted sales-invoice journal entry on the invoice row. */
export type InvoiceIssueResult = InvoiceWithLines;

/** Void response — includes ledger reversal outcome when B1 posting exists. */
export type InvoiceVoidResult = InvoiceWithLines & {
  ledger_reversal_status: 'reversed' | 'skipped_no_posting';
};
