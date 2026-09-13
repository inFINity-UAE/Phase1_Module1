import { IsString, MinLength } from 'class-validator';

/** [feature-spec-1_1_E.md E-25] Owner override — reason required; match_status unchanged. */
export class OverrideMatchBlockDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}
