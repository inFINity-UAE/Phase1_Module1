import { InvoiceLine } from './invoice-line.entity';
import { Invoice } from './invoice.entity';
import { CreditLimitCheck } from '../../reports/entities/credit-limit-check.entity';

export class InvoiceWithLines {
  invoice!: Invoice;
  lines!: InvoiceLine[];
}

/**
 * [feature-spec-1_1_D.md §5.3 / D-4] Issue response includes optional credit-limit alert.
 * Never rejects — alert only.
 */
export type InvoiceIssueResult = InvoiceWithLines & {
  credit_limit_check?: CreditLimitCheck;
};

/** Void response — includes ledger reversal outcome when B1 posting exists. */
export type InvoiceVoidResult = InvoiceWithLines & {
  ledger_reversal_status: 'reversed' | 'skipped_no_posting';
};
