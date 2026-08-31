import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';
import { CreateQuotationLineDto } from './create-quotation-line.dto';

export class CreateQuotationLineRequestDto extends CreateQuotationLineDto {
  @IsPostgresUuid()
  quotation_id!: string;
}
