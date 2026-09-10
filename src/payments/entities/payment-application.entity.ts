/** Row shape for `payment_applications` — [feature-spec-1_1_D.md §3.3]. */
export class PaymentApplication {
  id!: string;
  payment_id!: string;
  invoice_id!: string;
  applied_amount!: number;
  applied_at!: string;
  applied_by!: string;
}
