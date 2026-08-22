import { Inject, Injectable } from '@nestjs/common';
import { handleDatabaseError } from '../common/errors/database-error.mapper';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';
import { AuditLogEntry } from './entities/audit-log-entry.entity';
import { AUDIT_LOG_REPOSITORY, AuditLogRepository } from './audit-log.repository';

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
}
