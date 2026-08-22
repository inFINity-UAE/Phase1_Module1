import { IsDateString, IsOptional } from 'class-validator';

export class RunRecurringGenerationDto {
  @IsOptional()
  @IsDateString()
  as_of_date?: string;
}
