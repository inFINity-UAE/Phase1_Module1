import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';
import { JournalEntryType } from '../../common/enums/journal-entry-type.enum';
import { JournalEntryStatus } from '../../common/enums/journal-entry-status.enum';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

/** Writable columns of public.journal_entries. Required = NOT NULL with no default. [schema.sql] */
export class CreateJournalEntryDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsInt()
  entry_number!: number;

  @IsPostgresUuid()
  period_id!: string;

  @IsDateString()
  entry_date!: string;

  @IsOptional()
  @IsEnum(JournalEntryType)
  entry_type?: JournalEntryType;

  @IsOptional()
  @IsEnum(JournalEntryStatus)
  status?: JournalEntryStatus;

  @IsString()
  narration!: string;

  @IsOptional()
  @IsString()
  reference_number?: string;

  @IsOptional()
  @IsPostgresUuid()
  reverses_entry_id?: string;

  @IsOptional()
  @IsPostgresUuid()
  reversed_by_entry_id?: string;

  @IsOptional()
  @IsPostgresUuid()
  recurring_template_id?: string;

  @IsOptional()
  @IsBoolean()
  requires_approval?: boolean;

  @IsOptional()
  @IsPostgresUuid()
  approved_by?: string;

  @IsOptional()
  @IsDateString()
  approved_at?: string;

  @IsOptional()
  @IsPostgresUuid()
  rejected_by?: string;

  @IsOptional()
  @IsDateString()
  rejected_at?: string;

  @IsOptional()
  @IsString()
  rejection_reason?: string;

  @IsPostgresUuid()
  created_by!: string;

  @IsOptional()
  @IsDateString()
  posted_at?: string;
}
