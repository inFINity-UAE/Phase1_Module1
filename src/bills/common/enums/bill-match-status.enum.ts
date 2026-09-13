/** [feature-spec-1_1_E.md §3.2 / E-9] Three-way match outcomes. */
export enum BillMatchStatus {
  NoPo = 'no_po',
  AwaitingReceipt = 'awaiting_receipt',
  Matched = 'matched',
  QuantityMismatch = 'quantity_mismatch',
  PriceMismatch = 'price_mismatch',
  QuantityAndPriceMismatch = 'quantity_and_price_mismatch',
}
