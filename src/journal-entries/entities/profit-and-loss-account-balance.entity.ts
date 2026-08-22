import { AccountCategory } from '../../common/enums/account-category.enum';
import { NormalBalance } from '../../common/enums/normal-balance.enum';

/** Posted P&L activity for one account within a fiscal year — [Rules §4.11]. */
export class ProfitAndLossAccountBalance {
  account_id!: string;
  category!: AccountCategory;
  normal_balance!: NormalBalance;
  total_debit!: number;
  total_credit!: number;
  balance!: number;
}
