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
  // [feature-spec-1_1_E.md E-2 / §4.2 / §4.5 / E-21]
  PurchaseInvoice = 'purchase_invoice',
  SupplierPayment = 'supplier_payment',
  SupplierAdvance = 'supplier_advance',
  SupplierAdvanceApplication = 'supplier_advance_application',
  GrniAccrual = 'grni_accrual',
}
