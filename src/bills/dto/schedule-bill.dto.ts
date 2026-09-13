import { IsDateString } from 'class-validator';

/** [feature-spec-1_1_E.md E-7] Scheduling is a flag, not a posting event. */
export class ScheduleBillDto {
  @IsDateString()
  scheduled_payment_date!: string;
}
