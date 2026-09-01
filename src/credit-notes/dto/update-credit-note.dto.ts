import { IsDateString, IsOptional } from 'class-validator';

export class UpdateCreditNoteDto {
  @IsOptional()
  @IsDateString()
  credit_note_date?: string;
}
