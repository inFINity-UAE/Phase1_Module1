import { QueryAuditLogDto } from './dto/query-audit-log.dto';
import { AuditLogEntry } from './entities/audit-log-entry.entity';

export const AUDIT_LOG_REPOSITORY = Symbol('AUDIT_LOG_REPOSITORY');

export interface AuditLogRepository {
  find(query: QueryAuditLogDto): Promise<AuditLogEntry[]>;
}
