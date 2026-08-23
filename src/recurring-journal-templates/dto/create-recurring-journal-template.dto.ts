import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { RecurrenceFrequency } from '../../common/enums/recurrence-frequency.enum';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';
import { CreateRecurringJournalTemplateLineDto } from './create-recurring-journal-template-line.dto';

export class CreateRecurringJournalTemplateDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsString()
  template_name!: string;

  @IsString()
  narration_template!: string;

  @IsEnum(RecurrenceFrequency)
  frequency!: RecurrenceFrequency;

  @IsDateString()
  start_date!: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsDateString()
  next_run_date?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  day_of_month?: number;

  @IsOptional()
  @IsBoolean()
  auto_post?: boolean;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateRecurringJournalTemplateLineDto)
  lines!: CreateRecurringJournalTemplateLineDto[];
}
