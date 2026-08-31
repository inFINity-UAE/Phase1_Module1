import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';
import { CreateInvoiceLineDto } from './create-invoice-line.dto';

export class CreateInvoiceLineRequestDto extends CreateInvoiceLineDto {
  @IsPostgresUuid()
  invoice_id!: string;
}
