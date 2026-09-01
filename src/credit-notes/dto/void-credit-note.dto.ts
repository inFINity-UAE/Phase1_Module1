import { IsNotEmpty, IsString } from 'class-validator';

export class VoidCreditNoteDto {
  @IsString()
  @IsNotEmpty()
  void_reason!: string;
}
