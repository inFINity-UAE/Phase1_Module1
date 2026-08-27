import { IsDateString, IsOptional } from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

/**
 * [feature-spec.md decision #41] company_id required so run-due cannot batch
 * across tenants. Optional on generate-by-id (membership comes from :id).
 */
export class RunRecurringGenerationDto {
  @IsOptional()
  @IsPostgresUuid()
  company_id?: string;

  @IsOptional()
  @IsDateString()
  as_of_date?: string;
}
