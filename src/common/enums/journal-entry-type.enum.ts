// [schema.sql] journal_entry_type
export enum JournalEntryType {
  Manual = 'manual',
  Recurring = 'recurring',
  Reversal = 'reversal',
  OpeningBalance = 'opening_balance',
  YearEndClosing = 'year_end_closing',
  System = 'system',
  SalesInvoice = 'sales_invoice',
  CreditNote = 'credit_note',
  // [feature-spec-1_1_D.md §3.6]
  CustomerPayment = 'customer_payment',
  AdvanceReceipt = 'advance_receipt',
  AdvanceApplication = 'advance_application',
  WriteOff = 'write_off',
  EclProvision = 'ecl_provision',
}
