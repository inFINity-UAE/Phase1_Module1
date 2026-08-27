import { IsOptional, IsString } from 'class-validator';

/**
 * Account metadata update only — [feature-spec.md decision #36].
 * Editable: account_name, sub_category, description.
 * Forbidden (forbidNonWhitelisted): account_number, category, normal_balance,
 * parent_account_id, depth, is_system_account, is_active, locked_*,
 * company_id, and any identity/actor field. Deactivation stays on
 * PATCH /accounts/:id/deactivate; hard delete stays on DELETE.
 */
export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  account_name?: string;

  @IsOptional()
  @IsString()
  sub_category?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;
}
