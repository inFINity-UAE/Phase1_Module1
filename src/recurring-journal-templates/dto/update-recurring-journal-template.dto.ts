import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { RecurrenceFrequency } from '../../common/enums/recurrence-frequency.enum';

/**
 * Template header update only — [feature-spec.md §7.16 finding #3 / decision #43].
 * Purpose-built (not PartialType of create) so company_id / lines / created_by
 * cannot be smuggled. Editable columns match schema.sql recurring_journal_templates
 * schedule/metadata fields. Line mutations stay on dedicated line routes.
 */
export class UpdateRecurringJournalTemplateDto {
  @IsOptional()
  @IsString()
  template_name?: string;

  @IsOptional()
  @IsString()
  narration_template?: string;

  @IsOptional()
  @IsEnum(RecurrenceFrequency)
  frequency?: RecurrenceFrequency;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string | null;

  @IsOptional()
  @IsDateString()
  next_run_date?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  day_of_month?: number | null;

  @IsOptional()
  @IsBoolean()
  auto_post?: boolean;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
