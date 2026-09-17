import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

export class InvoiceRegisterQueryDto {
  @IsPostgresUuid()
  company_id!: string;

  @Type(() => Number)
  @IsInt()
  year!: number;
}

export class VatRegistrationThresholdQueryDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsOptional()
  @IsDateString()
  as_of?: string;
}
