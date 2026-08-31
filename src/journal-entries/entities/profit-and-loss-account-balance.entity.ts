import { AccountCategory } from '../../common/enums/account-category.enum';
import { NormalBalance } from '../../common/enums/normal-balance.enum';

/** P&L account balance for fiscal-year reads — [Rules §4.11]; RPC-backed (#64). */
export class ProfitAndLossAccountBalance {
  account_id!: string;
  category!: AccountCategory;
  normal_balance!: NormalBalance;
  total_debit!: number;
  total_credit!: number;
  balance!: number;
}
