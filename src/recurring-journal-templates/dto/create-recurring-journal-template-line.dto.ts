import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

export class CreateRecurringJournalTemplateLineDto {
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
}
