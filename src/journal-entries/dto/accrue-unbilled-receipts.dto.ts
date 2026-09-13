import { IsDateString } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

/** [feature-spec-1_1_E.md E-21 / §5.5] Manual GRNI accrual — not a cron. */
export class AccrueUnbilledReceiptsDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsDateString()
  period_end_date!: string;
}
