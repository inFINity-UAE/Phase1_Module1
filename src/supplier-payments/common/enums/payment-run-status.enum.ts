/** [feature-spec-1_1_E.md §4.3] Payment-run lifecycle. */
export enum PaymentRunStatus {
  Draft = 'draft',
  Approved = 'approved',
  Executed = 'executed',
  Cancelled = 'cancelled',
}
