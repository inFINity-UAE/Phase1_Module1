import { Injectable } from '@nestjs/common';
import { AuditAction } from '../common/enums/audit-action.enum';
import { SupabaseService } from '../database/supabase.service';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';
import { AuditLogEntry } from './entities/audit-log-entry.entity';
import {
  AuditLogRepository,
  InsertBlockedDeleteAuditParams,
} from './audit-log.repository';

function toStartOfDay(isoDate: string): string {
  return isoDate.length <= 10 ? `${isoDate}T00:00:00.000Z` : isoDate;
}

function toEndOfDay(isoDate: string): string {
  if (isoDate.length > 10) return isoDate;

  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCMilliseconds(date.getUTCMilliseconds() - 1);
  return date.toISOString();
}

@Injectable()
export class SupabaseAuditLogRepository implements AuditLogRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async find(query: QueryAuditLogDto): Promise<AuditLogEntry[]> {
    let request = this.supabase.client
      .from('audit_log')
      .select('*')
      .eq('company_id', query.company_id)
      .order('created_at', { ascending: true });

    if (query.record_id) {
      request = request.eq('record_id', query.record_id);
    }

    if (query.table_name) {
      request = request.eq('table_name', query.table_name);
    }

    if (query.actor_id) {
      request = request.eq('actor_id', query.actor_id);
    }

    if (query.from) {
      request = request.gte('created_at', toStartOfDay(query.from));
    }

    if (query.to) {
      request = request.lte('created_at', toEndOfDay(query.to));
    }

    const { data, error } = await request;

    if (error) throw error;

    return (data ?? []) as AuditLogEntry[];
  }

  /**
   * [feature-spec.md #56] Separate request from the failed DELETE so the
   * blocking trigger's ROLLBACK cannot erase this row.
   */
  async insertBlockedDelete(
    params: InsertBlockedDeleteAuditParams,
  ): Promise<AuditLogEntry> {
    const { data, error } = await this.supabase.client
      .from('audit_log')
      .insert({
        company_id: params.company_id,
        table_name: params.table_name,
        record_id: params.record_id,
        action: AuditAction.DeleteBlocked,
        actor_id: params.actor_id,
        old_data: params.old_data,
        new_data: null,
        notes: params.notes ?? null,
      })
      .select('*')
      .single();

    if (error) throw error;

    return data as AuditLogEntry;
  }
}
