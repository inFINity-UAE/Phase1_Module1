import { IsNumber, Min } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

/** [feature-spec-1_1_D.md §3.3] Apply unapplied payment credit to an invoice. */
export class CreatePaymentApplicationDto {
  @IsPostgresUuid()
  payment_id!: string;

  @IsPostgresUuid()
  invoice_id!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  applied_amount!: number;
}
