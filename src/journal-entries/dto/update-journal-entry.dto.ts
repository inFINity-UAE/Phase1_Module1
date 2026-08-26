import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CreateJournalAttachmentInputDto } from './create-journal-entry.dto';

/**
 * Draft header update only — [feature-spec.md decision #31].
 * Editable: narration, reference_number, entry_date, attachments.
 * Forbidden (forbidNonWhitelisted): status, lines, company_id, period_id,
 * created_by / approved_by / rejected_by / posted_at, and any other actor field.
 * Status transitions stay on post / approve / reject / reverse only.
 */
export class UpdateJournalEntryDto {
  @IsOptional()
  @IsString()
  narration?: string;

  @IsOptional()
  @IsString()
  reference_number?: string | null;

  @IsOptional()
  @IsDateString()
  entry_date?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateJournalAttachmentInputDto)
  attachments?: CreateJournalAttachmentInputDto[];
}
