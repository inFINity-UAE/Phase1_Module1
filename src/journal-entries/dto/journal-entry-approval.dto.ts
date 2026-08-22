import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { CompanyRole } from '../../common/enums/company-role.enum';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

/** Actor context for draft → post — [Rules §1.24] maker-checker threshold check. */
export class PostJournalEntryDto {
  @IsPostgresUuid()
  actor_id!: string;

  @IsEnum(CompanyRole)
  actor_role!: CompanyRole;

  /** Required when posting into a soft-closed period — [Rules §1.3] prior period adjustment. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  soft_closed_override_reason?: string;
}

/** Owner approval of a pending journal entry. */
export class ApproveJournalEntryDto {
  @IsPostgresUuid()
  actor_id!: string;

  @IsEnum(CompanyRole)
  actor_role!: CompanyRole;

  @IsOptional()
  @IsString()
  @MinLength(1)
  soft_closed_override_reason?: string;
}

/** Owner rejection of a pending journal entry. */
export class RejectJournalEntryDto {
  @IsPostgresUuid()
  actor_id!: string;

  @IsEnum(CompanyRole)
  actor_role!: CompanyRole;

  @IsString()
  @MinLength(1)
  rejection_reason!: string;
}
