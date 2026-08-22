import { Controller, Get, Query } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';

@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  /** Read-only audit history — no write endpoints by design. */
  @Get()
  find(@Query() query: QueryAuditLogDto) {
    return this.auditLogService.find(query);
  }
}
