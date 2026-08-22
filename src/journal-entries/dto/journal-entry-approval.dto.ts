import { IsEnum, IsString, MinLength } from 'class-validator';
import { CompanyRole } from '../../common/enums/company-role.enum';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

/** Actor context for draft → post — [Rules §1.24] maker-checker threshold check. */
export class PostJournalEntryDto {
  @IsPostgresUuid()
  actor_id!: string;

  @IsEnum(CompanyRole)
  actor_role!: CompanyRole;
}

/** Owner approval of a pending journal entry. */
export class ApproveJournalEntryDto {
  @IsPostgresUuid()
  actor_id!: string;

  @IsEnum(CompanyRole)
  actor_role!: CompanyRole;
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
