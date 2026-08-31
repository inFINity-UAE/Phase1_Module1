import { IsEnum, IsOptional } from 'class-validator';
import { InvoiceType } from '../common/enums/invoice-type.enum';

/** Optional floor override — tax_invoice only when permitted [§6.2]. */
export class IssueInvoiceDto {
  @IsOptional()
  @IsEnum(InvoiceType)
  invoice_type_override?: InvoiceType.TaxInvoice;
}
