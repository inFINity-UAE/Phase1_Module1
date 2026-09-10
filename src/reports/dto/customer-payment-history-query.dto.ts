import { IsUUID } from 'class-validator';

/** [feature-spec-1_1_D.md §5.5] Customer payment history / DSO. */
export class CustomerPaymentHistoryQueryDto {
  @IsUUID()
  company_id!: string;

  @IsUUID()
  customer_id!: string;
}
