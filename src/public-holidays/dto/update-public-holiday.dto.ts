import { IsDateString } from 'class-validator';

/**
 * [feature-spec-1_1_D.md §3.1b / D-14]
 * Moves holiday_date and flips status to CONFIRMED when Cabinet announces.
 */
export class UpdatePublicHolidayDto {
  @IsDateString()
  holiday_date!: string;
}
