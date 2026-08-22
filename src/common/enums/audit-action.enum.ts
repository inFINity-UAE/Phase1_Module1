// [schema.sql] audit_action
export enum AuditAction {
  Insert = 'insert',
  Update = 'update',
  Delete = 'delete',
  StatusChange = 'status_change',
  Reversal = 'reversal',
}
