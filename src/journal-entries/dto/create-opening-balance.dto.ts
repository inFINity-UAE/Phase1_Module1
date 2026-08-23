import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';
import { CreateJournalEntryLineInputDto } from './create-journal-entry.dto';

/** Opening balance import — [feature-spec] mid-year historical setup. */
export class CreateOpeningBalanceDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsInt()
  fiscal_year!: number;

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
}
