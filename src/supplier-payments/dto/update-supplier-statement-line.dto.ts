import { IsDateString, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateSupplierStatementLineDto {
  @IsOptional()
  @IsDateString()
  statement_date?: string;

  @IsOptional()
  @IsDateString()
  line_date?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  line_type?: string;

  @IsOptional()
  @IsString()
  reference?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  amount?: number;

  @IsOptional()
  @IsString()
  source?: string;
}
