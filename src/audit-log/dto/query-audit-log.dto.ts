import { IsDateString, IsOptional, IsString } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

/** Read-only audit trail query — [feature-spec] [Rules §1.24]. */
export class QueryAuditLogDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsOptional()
  @IsPostgresUuid()
  record_id?: string;

  @IsOptional()
  @IsString()
  table_name?: string;

  @IsOptional()
  @IsPostgresUuid()
  actor_id?: string;

  /** Inclusive lower bound on created_at (ISO date or datetime). */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Inclusive upper bound on created_at (ISO date or datetime). */
  @IsOptional()
  @IsDateString()
  to?: string;
}
