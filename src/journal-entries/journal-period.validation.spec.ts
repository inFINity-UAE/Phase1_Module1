import { assertPeriodUsableForCompany } from './journal-period.validation';

describe('assertPeriodUsableForCompany (§7.26 / decision #51)', () => {
  const companyId = '00000000-0000-0000-0000-000000000002';
  const otherCompanyId = '00000000-0000-0000-0000-000000000099';
  const periodId = '11111111-1111-1111-1111-111111111111';

  it('accepts a period belonging to the same company', () => {
    expect(() =>
      assertPeriodUsableForCompany(companyId, periodId, {
        id: periodId,
        company_id: companyId,
        period_start: '2026-01-01',
        period_end: '2026-01-31',
      }),
    ).not.toThrow();
  });

  it('rejects a missing period', () => {
    expect(() =>
      assertPeriodUsableForCompany(companyId, periodId, null),
    ).toThrow(/was not found/i);
  });

  it('rejects a cross-company period', () => {
    expect(() =>
      assertPeriodUsableForCompany(companyId, periodId, {
        id: periodId,
        company_id: otherCompanyId,
        period_start: '2026-01-01',
        period_end: '2026-01-31',
      }),
    ).toThrow(/different company/i);
  });

  it('no-ops when periodId is empty (callers with optional period)', () => {
    expect(() => assertPeriodUsableForCompany(companyId, '', null)).not.toThrow();
  });
});
