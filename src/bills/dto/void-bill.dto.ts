import { IsString, MinLength } from 'class-validator';

/** [feature-spec-1_1_E.md E-13] Void requires a non-empty reason. */
export class VoidBillDto {
  @IsString()
  @MinLength(1)
  void_reason!: string;
}
