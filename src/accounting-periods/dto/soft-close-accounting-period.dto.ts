import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

/** Soft-close an open accounting period — [feature-spec] period soft-close. */
export class SoftCloseAccountingPeriodDto {
  @IsPostgresUuid()
  closed_by!: string;
}
