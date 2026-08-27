import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { AuditLogService } from './audit-log.service';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';

/**
 * [feature-spec.md decisions #24/#41] Audit reads require session + membership
 * for query.company_id. actor_id remains a trail filter, not acting identity.
 */
@Controller('audit-log')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  /** Read-only audit history — no write endpoints by design. */
  @Get()
  @RequireCompanyMembership({ type: 'query' })
  find(@Query() query: QueryAuditLogDto) {
    return this.auditLogService.find(query);
  }
}
