// [schema.sql] journal_entry_status
export enum JournalEntryStatus {
  Draft = 'draft',
  PendingApproval = 'pending_approval',
  Approved = 'approved',
  Rejected = 'rejected',
  Posted = 'posted',
  Reversed = 'reversed',
}
