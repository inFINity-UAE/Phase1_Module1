import {
  assertAccountsUsableForCompany,
  assertOpeningBalanceAccountsUsable,
} from './journal-line-account.validation';

describe('assertAccountsUsableForCompany (decision #35)', () => {
  const companyId = '00000000-0000-0000-0000-000000000002';
  const otherCompanyId = '00000000-0000-0000-0000-000000000099';
  const accountA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const accountB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  it('accepts same-company active accounts', () => {
    expect(() =>
      assertAccountsUsableForCompany(
        companyId,
        [accountA, accountB],
        [
          { id: accountA, company_id: companyId, is_active: true, account_number: '1010' },
          { id: accountB, company_id: companyId, is_active: true, account_number: '1020' },
        ],
      ),
    ).not.toThrow();
  });

  it('rejects a missing account', () => {
    expect(() =>
      assertAccountsUsableForCompany(companyId, [accountA], []),
    ).toThrow(/was not found/i);
  });

  it('rejects a cross-company account', () => {
    expect(() =>
      assertAccountsUsableForCompany(
        companyId,
        [accountA],
        [{ id: accountA, company_id: otherCompanyId, is_active: true, account_number: '1010' }],
      ),
    ).toThrow(/different company/i);
  });

  it('rejects an inactive account', () => {
    expect(() =>
      assertAccountsUsableForCompany(
        companyId,
        [accountA],
        [{ id: accountA, company_id: companyId, is_active: false, account_number: '1050' }],
      ),
    ).toThrow(/inactive/i);
  });
});

describe('assertOpeningBalanceAccountsUsable (decision #57)', () => {
  const companyId = '00000000-0000-0000-0000-000000000002';
  const bank = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const income = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  it('accepts asset and equity accounts', () => {
    expect(() =>
      assertOpeningBalanceAccountsUsable(
        companyId,
        [bank, income],
        [
          { id: bank, company_id: companyId, is_active: true, category: 'asset' },
          { id: income, company_id: companyId, is_active: true, category: 'equity' },
        ],
      ),
    ).not.toThrow();
  });

  it('rejects income accounts', () => {
    expect(() =>
      assertOpeningBalanceAccountsUsable(
        companyId,
        [income],
        [{ id: income, company_id: companyId, is_active: true, category: 'income' }],
      ),
    ).toThrow(/asset, liability, or equity accounts/i);
  });

  it('rejects expense accounts', () => {
    expect(() =>
      assertOpeningBalanceAccountsUsable(
        companyId,
        [bank],
        [{ id: bank, company_id: companyId, is_active: true, category: 'expense' }],
      ),
    ).toThrow(/asset, liability, or equity accounts/i);
  });
});
