/** [feature-spec-1_1_E.md §3.2 / E-14 / E-28] Bill lifecycle statuses. */
export enum BillStatus {
  Draft = 'draft',
  Matched = 'matched',
  PendingApproval = 'pending_approval',
  Issued = 'issued',
  PartiallyPaid = 'partially_paid',
  Paid = 'paid',
  Disputed = 'disputed',
  Void = 'void',
}
