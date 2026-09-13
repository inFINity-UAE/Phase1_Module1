import { BillLine } from './bill-line.entity';
import { Bill } from './bill.entity';

export class BillWithLines {
  bill!: Bill;
  lines!: BillLine[];
}

/** Void response — includes ledger reversal outcome when posting exists. */
export type BillVoidResult = BillWithLines & {
  ledger_reversal_status: 'reversed' | 'skipped_no_posting';
};
