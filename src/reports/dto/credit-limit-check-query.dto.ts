import { IsUUID } from 'class-validator';

/** [feature-spec-1_1_D.md §5.3] Credit-limit check query. */
export class CreditLimitCheckQueryDto {
  @IsUUID()
  company_id!: string;

  @IsUUID()
  customer_id!: string;
}
