/** [feature-spec-1.1.C.md §2.2] Invoice lifecycle statuses. */
export enum InvoiceStatus {
  Draft = 'draft',
  Issued = 'issued',
  Sent = 'sent',
  Viewed = 'viewed',
  PartiallyPaid = 'partially_paid',
  Paid = 'paid',
  Overdue = 'overdue',
  WrittenOff = 'written_off',
  Void = 'void',
}
