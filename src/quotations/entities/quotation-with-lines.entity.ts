import { Quotation } from './quotation.entity';
import { QuotationLine } from './quotation-line.entity';

export class QuotationWithLines {
  quotation!: Quotation;
  lines!: QuotationLine[];
}
