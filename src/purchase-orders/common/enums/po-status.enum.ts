/** [feature-spec-1_1_E.md §3.4] Purchase-order lifecycle statuses. */
export enum PoStatus {
  Open = 'open',
  PartiallyReceived = 'partially_received',
  Received = 'received',
  Closed = 'closed',
  Cancelled = 'cancelled',
}
