import { IsBoolean } from 'class-validator';

/** [feature-spec-1_1_E.md §4.1] Dispute does not reverse an already-posted JE. */
export class DisputeBillDto {
  @IsBoolean()
  disputed!: boolean;
}
