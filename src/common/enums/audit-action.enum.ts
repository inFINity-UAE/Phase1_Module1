// [schema.sql] audit_action
export enum AuditAction {
  Insert = 'insert',
  Update = 'update',
  StatusChange = 'status_change',
  Reversal = 'reversal',
  /** Rejected hard-delete of a posted entry/line — feature-spec.md #56 */
  DeleteBlocked = 'delete_blocked',
}
