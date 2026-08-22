import { Module } from '@nestjs/common';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';
import { AUDIT_LOG_REPOSITORY } from './audit-log.repository';
import { SupabaseAuditLogRepository } from './audit-log.repository.supabase';

@Module({
  controllers: [AuditLogController],
  providers: [
    AuditLogService,
    {
      provide: AUDIT_LOG_REPOSITORY,
      useClass: SupabaseAuditLogRepository,
    },
  ],
  exports: [AuditLogService, AUDIT_LOG_REPOSITORY],
})
export class AuditLogModule {}
