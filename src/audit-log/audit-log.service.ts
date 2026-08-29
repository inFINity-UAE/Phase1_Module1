import { Inject, Injectable } from '@nestjs/common';
import { handleDatabaseError } from '../common/errors/database-error.mapper';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';
import { AuditLogEntry } from './entities/audit-log-entry.entity';
import {
  AUDIT_LOG_REPOSITORY,
  AuditLogRepository,
  InsertBlockedDeleteAuditParams,
} from './audit-log.repository';

@Injectable()
export class AuditLogService {
  constructor(
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  /**
   * [feature-spec] Immutable audit trail — read only.
   * [Rules §1.24] Who changed what, when, before/after values.
   */
  async find(query: QueryAuditLogDto): Promise<AuditLogEntry[]> {
    try {
      return await this.auditLogRepository.find(query);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec.md #56] Record a rejected hard-delete of a posted
   * journal entry or line. Must run outside the DELETE transaction.
   */
  async recordBlockedDelete(
    params: InsertBlockedDeleteAuditParams,
  ): Promise<AuditLogEntry> {
    try {
      return await this.auditLogRepository.insertBlockedDelete(params);
    } catch (error) {
      handleDatabaseError(error);
    }
  }
}
