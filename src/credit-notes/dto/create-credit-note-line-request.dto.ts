import { IsUUID } from 'class-validator';
import { CreateCreditNoteLineDto } from './create-credit-note-line.dto';

export class CreateCreditNoteLineRequestDto extends CreateCreditNoteLineDto {
  @IsUUID()
  credit_note_id!: string;
}
