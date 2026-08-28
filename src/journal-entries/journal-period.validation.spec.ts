import {
  assertEntryDateWithinPeriod,
  assertPeriodUsableForCompany,
  assertRecurringTemplateUsableForCompany,
} from './journal-period.validation';

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

describe('assertEntryDateWithinPeriod (§7.30)', () => {
  const period = {
    period_start: '2026-01-01',
    period_end: '2026-01-31',
  };

  it('accepts entry_date within the period range', () => {
    expect(() => assertEntryDateWithinPeriod('2026-01-15', period)).not.toThrow();
    expect(() => assertEntryDateWithinPeriod('2026-01-01', period)).not.toThrow();
    expect(() => assertEntryDateWithinPeriod('2026-01-31', period)).not.toThrow();
  });

  it('rejects entry_date before period_start', () => {
    expect(() => assertEntryDateWithinPeriod('2025-12-31', period)).toThrow(
      /must fall within accounting period/i,
    );
  });

  it('rejects entry_date after period_end', () => {
    expect(() => assertEntryDateWithinPeriod('2026-02-01', period)).toThrow(
      /must fall within accounting period/i,
    );
  });
});

describe('assertRecurringTemplateUsableForCompany (§7.30)', () => {
  const companyId = '00000000-0000-0000-0000-000000000002';
  const otherCompanyId = '00000000-0000-0000-0000-000000000099';
  const templateId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  it('accepts a template belonging to the same company', () => {
    expect(() =>
      assertRecurringTemplateUsableForCompany(companyId, templateId, {
        id: templateId,
        company_id: companyId,
      }),
    ).not.toThrow();
  });

  it('rejects a missing template', () => {
    expect(() =>
      assertRecurringTemplateUsableForCompany(companyId, templateId, null),
    ).toThrow(/was not found/i);
  });

  it('rejects a cross-company template', () => {
    expect(() =>
      assertRecurringTemplateUsableForCompany(companyId, templateId, {
        id: templateId,
        company_id: otherCompanyId,
      }),
    ).toThrow(/different company/i);
  });

  it('no-ops when templateId is empty', () => {
    expect(() =>
      assertRecurringTemplateUsableForCompany(companyId, '', null),
    ).not.toThrow();
  });
});
