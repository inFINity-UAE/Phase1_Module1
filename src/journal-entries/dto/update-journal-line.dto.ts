import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

/**
 * Draft-line update only — [feature-spec.md §7.26 finding #2].
 * Purpose-built (not PartialType of create DTO) so clients cannot reassign
 * `journal_entry_id`. Forbidden: created_at, journal_entry_id, and any actor field.
 */
export class UpdateJournalLineDto {
  @IsOptional()
  @IsInt()
  line_number?: number;

  @IsOptional()
  @IsPostgresUuid()
  account_id?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  debit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  credit?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  cost_center?: string;
}
