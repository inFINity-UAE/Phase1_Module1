import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';
import { CreateQuotationLineDto } from './create-quotation-line.dto';

export class CreateQuotationDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsPostgresUuid()
  customer_id!: string;

  @IsDateString()
  quotation_date!: string;

  @IsOptional()
  @IsDateString()
  valid_until?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateQuotationLineDto)
  lines?: CreateQuotationLineDto[];
}
