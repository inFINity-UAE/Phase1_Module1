import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { AuditLogService } from './audit-log.service';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';

/**
 * [feature-spec.md decision #24] Audit reads require an authenticated session —
 * controller-level guard (same pattern as decision #21). Query filters such as
 * actor_id remain client-supplied filters of the trail, not acting identity.
 */
@Controller('audit-log')
@UseGuards(SupabaseAuthGuard)
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  /** Read-only audit history — no write endpoints by design. */
  @Get()
  find(@Query() query: QueryAuditLogDto) {
    return this.auditLogService.find(query);
  }
}
