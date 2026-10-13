import { AccountCategory } from '../common/enums/account-category.enum';
import { NormalBalance } from '../common/enums/normal-balance.enum';
import { ProfitAndLossAccountBalance } from './entities/profit-and-loss-account-balance.entity';

export interface YearEndClosingLineInput {
  line_number: number;
  account_id: string;
  debit?: number;
  credit?: number;
  description?: string;
}

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Signed balance per normal_balance convention — matches v_trial_balance. */
export function computeAccountBalance(
  normalBalance: NormalBalance,
  totalDebit: number,
  totalCredit: number,
): number {
  if (normalBalance === NormalBalance.Debit) return roundMoney(totalDebit - totalCredit);

  return roundMoney(totalCredit - totalDebit);
}

/**
 * [Rules §4.11] Close income/expense balances into Retained Earnings.
 * Income (credit-normal): debit to zero. Expense (debit-normal): credit to zero.
 */
export function buildYearEndClosingLines(
  plBalances: ProfitAndLossAccountBalance[],
  retainedEarningsAccountId: string,
): YearEndClosingLineInput[] {
  const lines: YearEndClosingLineInput[] = [];
  let lineNumber = 1;
  let totalDebits = 0;
  let totalCredits = 0;

  for (const account of plBalances) {
    const amount = roundMoney(account.balance);
    if (amount === 0) {
      continue;
    }

    if (account.category === AccountCategory.Income) {
      lines.push({
        line_number: lineNumber++,
        account_id: account.account_id,
        debit: amount,
        credit: 0,
        description: 'Year-end close — zero income balance',
      });
      totalDebits += amount;
      continue;
    }

    if (account.category === AccountCategory.Expense) {
      lines.push({
        line_number: lineNumber++,
        account_id: account.account_id,
        debit: 0,
        credit: amount,
        description: 'Year-end close — zero expense balance',
      });
      totalCredits += amount;
    }
  }

  const netToRetainedEarnings = roundMoney(totalDebits - totalCredits);
  if (netToRetainedEarnings > 0) {
    lines.push({
      line_number: lineNumber++,
      account_id: retainedEarningsAccountId,
      debit: 0,
      credit: netToRetainedEarnings,
      description: 'Year-end close — net P&L to Retained Earnings',
    });
  } else if (netToRetainedEarnings < 0) {
    lines.push({
      line_number: lineNumber++,
      account_id: retainedEarningsAccountId,
      debit: Math.abs(netToRetainedEarnings),
      credit: 0,
      description: 'Year-end close — net P&L to Retained Earnings',
    });
  }

  return lines;
}
