/** [feature-spec-1_1_C.md §2.2] Invoice lifecycle statuses. */
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
