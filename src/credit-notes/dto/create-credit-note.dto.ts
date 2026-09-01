import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { CreateCreditNoteLineDto } from './create-credit-note-line.dto';

export class CreateCreditNoteDto {
  @IsUUID()
  company_id!: string;

  @IsUUID()
  original_invoice_id!: string;

  @IsDateString()
  credit_note_date!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateCreditNoteLineDto)
  lines!: CreateCreditNoteLineDto[];
}
