import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateCreditNoteLineDto {
  @IsInt()
  @Min(1)
  @Max(32767)
  line_number!: number;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsNumber()
  @Min(0.0001)
  @Type(() => Number)
  quantity!: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  unit_price!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  discount_percent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  discount_amount?: number;

  @ValidateIf((dto: CreateCreditNoteLineDto) => !dto.original_invoice_line_id)
  @IsNumber()
  @Type(() => Number)
  vat_rate?: number;

  @IsOptional()
  @IsUUID()
  original_invoice_line_id?: string;

  @ValidateIf((dto: CreateCreditNoteLineDto) => !dto.original_invoice_line_id)
  @IsString()
  @IsNotEmpty()
  reason?: string;

  @ValidateIf((dto: CreateCreditNoteLineDto) => !dto.original_invoice_line_id)
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  is_service?: boolean;

  @ValidateIf((dto: CreateCreditNoteLineDto) => !dto.original_invoice_line_id)
  @IsOptional()
  @IsUUID()
  income_account_id?: string;
}
