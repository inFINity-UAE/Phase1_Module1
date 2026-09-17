import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { UaeEmirate } from '../../common/enums/uae-emirate.enum';
import { VatCategory } from '../../common/enums/vat-category.enum';

export class CreateQuotationLineDto {
  @IsNumber()
  @Min(1)
  line_number!: number;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unit_price!: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  discount_percent?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  discount_amount?: number | null;

  @IsNumber()
  @Min(0)
  vat_rate!: number;

  @IsOptional()
  @IsEnum(VatCategory)
  vat_category?: VatCategory | null;

  @IsOptional()
  @IsEnum(UaeEmirate)
  emirate?: UaeEmirate | null;

  @IsOptional()
  @IsBoolean()
  is_service?: boolean;
}
