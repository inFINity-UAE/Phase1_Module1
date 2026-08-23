import { IsOptional, IsString, MinLength } from 'class-validator';

/** Draft → post — [Rules §1.24] maker-checker threshold check. Actor identity/role from session. */
export class PostJournalEntryDto {
  /** Required when posting into a soft-closed period — [Rules §1.3] prior period adjustment. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  soft_closed_override_reason?: string;
}

/** Owner or Manager approval of a pending journal entry — [Module 1.6.B]. */
export class ApproveJournalEntryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  soft_closed_override_reason?: string;
}

/** Owner or Manager rejection of a pending journal entry — [Module 1.6.B]. */
export class RejectJournalEntryDto {
  @IsString()
  @MinLength(1)
  rejection_reason!: string;
}
