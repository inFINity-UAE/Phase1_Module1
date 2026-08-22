import { AccountCategory } from '../../common/enums/account-category.enum';
import { NormalBalance } from '../../common/enums/normal-balance.enum';

/** Row shape of public.accounts — [schema.sql] */
export class Account {
  id!: string;
  company_id!: string;
  account_number!: string;
  account_name!: string;
  category!: AccountCategory;
  sub_category!: string | null;
  normal_balance!: NormalBalance;
  parent_account_id!: string | null;
  depth!: number;
  is_system_account!: boolean;
  is_active!: boolean;
  locked_at!: string | null;
  locked_reason!: string | null;
  description!: string | null;
  created_at!: string;
  updated_at!: string;
}
