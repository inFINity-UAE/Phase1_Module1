import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

/** [feature-spec-1_1_D.md §4.4 / D-9] Body for POST /invoices/:id/write-off */
export class WriteOffInvoiceDto {
  @IsString()
  @MinLength(1)
  reason!: string;

  /** Optional FTA notice date; can also be set later. */
  @IsOptional()
  @IsDateString()
  debtor_notified_at?: string;
}
