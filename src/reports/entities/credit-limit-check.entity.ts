/** [feature-spec-1_1_D.md §5.3 / D-4] Credit-limit alert payload (non-blocking). */
export class CreditLimitCheck {
  customer_id!: string;
  credit_limit!: number | null;
  open_invoice_outstanding!: number;
  unapplied_advance_credit!: number;
  outstanding_balance!: number;
  exceeds_credit_limit!: boolean;
  alert!: string | null;
}
