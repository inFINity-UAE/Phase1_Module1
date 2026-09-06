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
}
