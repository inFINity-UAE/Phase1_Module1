import { AccountCategory } from '../common/enums/account-category.enum';
import { NormalBalance } from '../common/enums/normal-balance.enum';
import { ProfitAndLossAccountBalance } from './entities/profit-and-loss-account-balance.entity';
import {
  buildYearEndClosingLines,
  computeAccountBalance,
} from './year-end-closing.util';

const RETAINED_EARNINGS_ID = '3e393fe1-29e4-46b3-b447-f0939b8683da';
const INCOME_ID = 'f7dc3374-7da4-4c62-b05e-2bbd3ced77b2';
const EXPENSE_ID = 'ca13540e-90c1-4184-bef6-fdc0a79b02c7';

describe('year-end-closing.util', () => {
  describe('computeAccountBalance', () => {
    it('returns credit-normal balance as credits minus debits', () => {
      expect(
        computeAccountBalance(NormalBalance.Credit, 0, 1000),
      ).toBe(1000);
    });

    it('returns debit-normal balance as debits minus credits', () => {
      expect(
        computeAccountBalance(NormalBalance.Debit, 600, 0),
      ).toBe(600);
    });
  });

  describe('buildYearEndClosingLines', () => {
    it('zeros income/expense and posts net profit to Retained Earnings', () => {
      const plBalances: ProfitAndLossAccountBalance[] = [
        {
          account_id: INCOME_ID,
          category: AccountCategory.Income,
          normal_balance: NormalBalance.Credit,
          total_debit: 0,
          total_credit: 1000,
          balance: 1000,
        },
        {
          account_id: EXPENSE_ID,
          category: AccountCategory.Expense,
          normal_balance: NormalBalance.Debit,
          total_debit: 600,
          total_credit: 0,
          balance: 600,
        },
      ];

      const lines = buildYearEndClosingLines(plBalances, RETAINED_EARNINGS_ID);

      expect(lines).toEqual([
        {
          line_number: 1,
          account_id: INCOME_ID,
          debit: 1000,
          credit: 0,
          description: 'Year-end close — zero income balance',
        },
        {
          line_number: 2,
          account_id: EXPENSE_ID,
          debit: 0,
          credit: 600,
          description: 'Year-end close — zero expense balance',
        },
        {
          line_number: 3,
          account_id: RETAINED_EARNINGS_ID,
          debit: 0,
          credit: 400,
          description: 'Year-end close — net P&L to Retained Earnings',
        },
      ]);

      const totalDebit = lines.reduce((sum, line) => sum + (line.debit ?? 0), 0);
      const totalCredit = lines.reduce((sum, line) => sum + (line.credit ?? 0), 0);
      expect(totalDebit).toBe(totalCredit);
    });

    it('posts net loss to Retained Earnings as a debit', () => {
      const plBalances: ProfitAndLossAccountBalance[] = [
        {
          account_id: INCOME_ID,
          category: AccountCategory.Income,
          normal_balance: NormalBalance.Credit,
          total_debit: 0,
          total_credit: 200,
          balance: 200,
        },
        {
          account_id: EXPENSE_ID,
          category: AccountCategory.Expense,
          normal_balance: NormalBalance.Debit,
          total_debit: 500,
          total_credit: 0,
          balance: 500,
        },
      ];

      const lines = buildYearEndClosingLines(plBalances, RETAINED_EARNINGS_ID);
      const reLine = lines.find((line) => line.account_id === RETAINED_EARNINGS_ID);

      expect(reLine).toEqual({
        line_number: 3,
        account_id: RETAINED_EARNINGS_ID,
        debit: 300,
        credit: 0,
        description: 'Year-end close — net P&L to Retained Earnings',
      });
    });
  });
});
