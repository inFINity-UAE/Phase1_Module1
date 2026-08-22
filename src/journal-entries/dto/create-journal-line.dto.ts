import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

/** Writable columns of public.journal_lines. Required = NOT NULL with no default. [schema.sql] */
export class CreateJournalLineDto {
  @IsPostgresUuid()
  journal_entry_id!: string;

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
