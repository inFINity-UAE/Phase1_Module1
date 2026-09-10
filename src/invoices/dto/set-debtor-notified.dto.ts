import { IsDateString } from 'class-validator';

/** [feature-spec-1_1_D.md §4.4] Follow-up: set debtor notice date after write-off. */
export class SetDebtorNotifiedDto {
  @IsDateString()
  debtor_notified_at!: string;
}
