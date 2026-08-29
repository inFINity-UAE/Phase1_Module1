import { QueryAuditLogDto } from './dto/query-audit-log.dto';
import { AuditLogEntry } from './entities/audit-log-entry.entity';

export const AUDIT_LOG_REPOSITORY = Symbol('AUDIT_LOG_REPOSITORY');

/** [feature-spec.md #56] Blocked hard-delete attempt — own transaction. */
export interface InsertBlockedDeleteAuditParams {
  company_id: string;
  table_name: 'journal_entries' | 'journal_lines';
  record_id: string;
  actor_id: string;
  old_data: Record<string, unknown> | null;
  notes?: string | null;
}

export interface AuditLogRepository {
  find(query: QueryAuditLogDto): Promise<AuditLogEntry[]>;
  insertBlockedDelete(params: InsertBlockedDeleteAuditParams): Promise<AuditLogEntry>;
}
