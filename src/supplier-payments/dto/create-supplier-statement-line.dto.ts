import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

export class CreateSupplierStatementLineDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsPostgresUuid()
  supplier_id!: string;

  @IsDateString()
  statement_date!: string;

  @IsDateString()
  line_date!: string;

  @IsString()
  line_type!: string;

  @IsOptional()
  @IsString()
  reference?: string | null;

  /** [feature-spec-1_1_E.md §3.13] signed `numeric(18,2)`; credits are not forced positive. */
  @IsNumber({ maxDecimalPlaces: 2 })
  amount!: number;

  @IsOptional()
  @IsString()
  source?: string;
}
