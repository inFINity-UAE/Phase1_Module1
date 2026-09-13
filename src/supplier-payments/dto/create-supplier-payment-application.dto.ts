import { IsNumber, Min } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

export class CreateSupplierPaymentApplicationDto {
  @IsPostgresUuid()
  bill_id!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  applied_amount!: number;
}
