import { IsString, MinLength } from 'class-validator';

export class VoidInvoiceDto {
  @IsString()
  @MinLength(1)
  void_reason!: string;
}
