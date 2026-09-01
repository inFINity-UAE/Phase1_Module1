import { CreditNoteStatus } from '../common/enums/credit-note-status.enum';

export class CreditNote {
  id!: string;
  company_id!: string;
  customer_id!: string;
  original_invoice_id!: string;
  credit_note_number!: string | null;
  credit_note_date!: string;
  status!: CreditNoteStatus;
  subtotal!: number;
  vat_total!: number;
  grand_total!: number;
  journal_entry_id!: string | null;
  void_reason!: string | null;
  created_by!: string;
  created_at!: string;
  updated_at!: string;
}
