import { InvoiceLine } from './invoice-line.entity';
import { Invoice } from './invoice.entity';

export class InvoiceWithLines {
  invoice!: Invoice;
  lines!: InvoiceLine[];
}

/** Issue response — includes posted sales-invoice journal entry on the invoice row. */
export type InvoiceIssueResult = InvoiceWithLines;
