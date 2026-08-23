import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

/** Line input nested on draft journal entry create — [schema.sql journal_lines] */
export class CreateJournalEntryLineInputDto {
  @IsInt()
  line_number!: number;

  @IsPostgresUuid()
  account_id!: string;

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

/** Attachment input nested on draft journal entry create — [schema.sql journal_attachments] */
export class CreateJournalAttachmentInputDto {
  @IsString()
  file_name!: string;

  @IsString()
  file_url!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  file_size_bytes?: number;
}

/** Draft manual journal entry create — [feature-spec] narration, reference, attachments. */
export class CreateJournalEntryDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsPostgresUuid()
  period_id!: string;

  @IsDateString()
  entry_date!: string;

  @IsString()
  narration!: string;

  @IsOptional()
  @IsString()
  reference_number?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateJournalEntryLineInputDto)
  lines!: CreateJournalEntryLineInputDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateJournalAttachmentInputDto)
  attachments?: CreateJournalAttachmentInputDto[];
}
