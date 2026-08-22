import { AuditAction } from '../../common/enums/audit-action.enum';

/** Row from public.audit_log — [Rules §1.24] immutable audit trail. */
export class AuditLogEntry {
  id!: string;
  company_id!: string;
  table_name!: string;
  record_id!: string;
  action!: AuditAction;
  actor_id!: string;
  old_data!: Record<string, unknown> | null;
  new_data!: Record<string, unknown> | null;
  notes!: string | null;
  created_at!: string;
}
