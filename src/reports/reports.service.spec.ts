import { BadRequestException } from '@nestjs/common';
import {
  ReportsService,
  serverAsOfDateToday,
  summarizeBalanceSheet,
  summarizeProfitAndLoss,
} from './reports.service';
import { ReportsRepository } from './reports.repository';

describe('ReportsService (period trial balance)', () => {
  const COMPANY_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const PERIOD_ID = '22222222-2222-2222-2222-222222222222';
  const OTHER_COMPANY = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  let repository: jest.Mocked<ReportsRepository>;
  let service: ReportsService;

  beforeEach(() => {
    repository = {
      findPeriodCompanyRow: jest.fn(),
      findAccountCompanyRow: jest.fn(),
      getTrialBalanceForPeriod: jest.fn().mockResolvedValue([]),
      getBalanceSheet: jest.fn().mockResolvedValue([]),
      getProfitAndLoss: jest.fn().mockResolvedValue([]),
      getGeneralLedger: jest.fn().mockResolvedValue([]),
      getCustomerLedger: jest.fn().mockResolvedValue([]),
      getAgedReceivables: jest.fn().mockResolvedValue([]),
      checkCustomerCreditLimit: jest.fn().mockResolvedValue({
        customer_id: '00000000-0000-0000-0000-000000000001',
        credit_limit: null,
        open_invoice_outstanding: 0,
        unapplied_advance_credit: 0,
        outstanding_balance: 0,
        exceeds_credit_limit: false,
        alert: null,
      }),
      getCustomerPaymentHistory: jest.fn().mockResolvedValue({
        customer_id: '00000000-0000-0000-0000-000000000001',
        invoice_count: 0,
        average_actual_days_to_pay: null,
        average_terms_days: null,
        invoices: [],
      }),
      findCustomerCompanyRow: jest.fn(),
      findSupplierCompanyRow: jest.fn(),
      getSupplierLedger: jest.fn().mockResolvedValue([]),
      getAgedPayables: jest.fn().mockResolvedValue([]),
      getBillsDue: jest.fn().mockResolvedValue([]),
      reconcileSupplierStatement: jest.fn().mockResolvedValue({}),
    };
    service = new ReportsService(repository);
  });

  it('rejects missing period via assertPeriodUsableForCompany', async () => {
    repository.findPeriodCompanyRow.mockResolvedValue(null);

    await expect(
      service.getTrialBalance(COMPANY_ID, PERIOD_ID),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.getTrialBalanceForPeriod).not.toHaveBeenCalled();
  });

  it('rejects period belonging to another company', async () => {
    repository.findPeriodCompanyRow.mockResolvedValue({
      id: PERIOD_ID,
      company_id: OTHER_COMPANY,
      period_start: '2026-01-01',
      period_end: '2026-01-31',
    });

    await expect(
      service.getTrialBalance(COMPANY_ID, PERIOD_ID),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.getTrialBalanceForPeriod).not.toHaveBeenCalled();
  });

  it('calls RPC when period belongs to company', async () => {
    repository.findPeriodCompanyRow.mockResolvedValue({
      id: PERIOD_ID,
      company_id: COMPANY_ID,
      period_start: '2026-01-01',
      period_end: '2026-01-31',
    });
    repository.getTrialBalanceForPeriod.mockResolvedValue([
      {
        account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        account_number: '1020',
        account_name: 'Bank',
        category: 'asset',
        normal_balance: 'debit',
        opening_debit: 0,
        opening_credit: 0,
        opening_balance: 0,
        period_debit: 100,
        period_credit: 0,
        closing_debit: 100,
        closing_credit: 0,
        closing_balance: 100,
      },
    ]);

    const rows = await service.getTrialBalance(COMPANY_ID, PERIOD_ID, true);

    expect(repository.getTrialBalanceForPeriod).toHaveBeenCalledWith(
      COMPANY_ID,
      PERIOD_ID,
      true,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].closing_balance).toBe(100);
  });
});

describe('ReportsService (balance sheet)', () => {
  const COMPANY_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  let repository: jest.Mocked<ReportsRepository>;
  let service: ReportsService;

  beforeEach(() => {
    repository = {
      findPeriodCompanyRow: jest.fn(),
      findAccountCompanyRow: jest.fn(),
      getTrialBalanceForPeriod: jest.fn(),
      getBalanceSheet: jest.fn().mockResolvedValue([]),
      getProfitAndLoss: jest.fn().mockResolvedValue([]),
      getGeneralLedger: jest.fn().mockResolvedValue([]),
      getCustomerLedger: jest.fn().mockResolvedValue([]),
      getAgedReceivables: jest.fn().mockResolvedValue([]),
      checkCustomerCreditLimit: jest.fn().mockResolvedValue({
        customer_id: '00000000-0000-0000-0000-000000000001',
        credit_limit: null,
        open_invoice_outstanding: 0,
        unapplied_advance_credit: 0,
        outstanding_balance: 0,
        exceeds_credit_limit: false,
        alert: null,
      }),
      getCustomerPaymentHistory: jest.fn().mockResolvedValue({
        customer_id: '00000000-0000-0000-0000-000000000001',
        invoice_count: 0,
        average_actual_days_to_pay: null,
        average_terms_days: null,
        invoices: [],
      }),
      findCustomerCompanyRow: jest.fn(),
      findSupplierCompanyRow: jest.fn(),
      getSupplierLedger: jest.fn().mockResolvedValue([]),
      getAgedPayables: jest.fn().mockResolvedValue([]),
      getBillsDue: jest.fn().mockResolvedValue([]),
      reconcileSupplierStatement: jest.fn().mockResolvedValue({}),
    };
    service = new ReportsService(repository);
  });

  it('defaults omitted as_of_date to server today', async () => {
    const today = serverAsOfDateToday();
    await service.getBalanceSheet(COMPANY_ID);
    expect(repository.getBalanceSheet).toHaveBeenCalledWith(COMPANY_ID, today);
  });

  it('passes explicit as_of_date through and builds summary', async () => {
    repository.getBalanceSheet.mockResolvedValue([
      {
        account_id: 'a1',
        account_number: '1020',
        account_name: 'Bank',
        category: 'asset',
        normal_balance: 'debit',
        total_debit: 500,
        total_credit: 0,
        balance: 500,
      },
      {
        account_id: 'a2',
        account_number: '3000',
        account_name: 'Share Capital',
        category: 'equity',
        normal_balance: 'credit',
        total_debit: 0,
        total_credit: 500,
        balance: 500,
      },
    ]);

    const report = await service.getBalanceSheet(COMPANY_ID, '2026-01-15');

    expect(repository.getBalanceSheet).toHaveBeenCalledWith(
      COMPANY_ID,
      '2026-01-15',
    );
    expect(report.as_of_date).toBe('2026-01-15');
    expect(report.total_assets).toBe(500);
    expect(report.total_liabilities).toBe(0);
    expect(report.total_equity).toBe(500);
    expect(report.is_balanced).toBe(true);
  });

  it('summarizeBalanceSheet sets is_balanced false when A ≠ L+E', () => {
    const report = summarizeBalanceSheet('2026-01-01', [
      {
        account_id: 'a1',
        account_number: '1020',
        account_name: 'Bank',
        category: 'asset',
        normal_balance: 'debit',
        total_debit: 100,
        total_credit: 0,
        balance: 100,
      },
    ]);
    expect(report.is_balanced).toBe(false);
  });
});

describe('ReportsService (profit and loss)', () => {
  const COMPANY_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  let repository: jest.Mocked<ReportsRepository>;
  let service: ReportsService;

  beforeEach(() => {
    repository = {
      findPeriodCompanyRow: jest.fn(),
      findAccountCompanyRow: jest.fn(),
      getTrialBalanceForPeriod: jest.fn(),
      getBalanceSheet: jest.fn(),
      getProfitAndLoss: jest.fn().mockResolvedValue([]),
      getGeneralLedger: jest.fn().mockResolvedValue([]),
      getCustomerLedger: jest.fn().mockResolvedValue([]),
      getAgedReceivables: jest.fn().mockResolvedValue([]),
      checkCustomerCreditLimit: jest.fn().mockResolvedValue({
        customer_id: '00000000-0000-0000-0000-000000000001',
        credit_limit: null,
        open_invoice_outstanding: 0,
        unapplied_advance_credit: 0,
        outstanding_balance: 0,
        exceeds_credit_limit: false,
        alert: null,
      }),
      getCustomerPaymentHistory: jest.fn().mockResolvedValue({
        customer_id: '00000000-0000-0000-0000-000000000001',
        invoice_count: 0,
        average_actual_days_to_pay: null,
        average_terms_days: null,
        invoices: [],
      }),
      findCustomerCompanyRow: jest.fn(),
      findSupplierCompanyRow: jest.fn(),
      getSupplierLedger: jest.fn().mockResolvedValue([]),
      getAgedPayables: jest.fn().mockResolvedValue([]),
      getBillsDue: jest.fn().mockResolvedValue([]),
      reconcileSupplierStatement: jest.fn().mockResolvedValue({}),
    };
    service = new ReportsService(repository);
  });

  it('rejects period_end before period_start with 400', async () => {
    await expect(
      service.getProfitAndLoss(COMPANY_ID, '2026-02-01', '2026-01-01'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.getProfitAndLoss).not.toHaveBeenCalled();
  });

  it('summarizes income − expense as net_profit (YE lockstep)', async () => {
    repository.getProfitAndLoss.mockResolvedValue([
      {
        account_id: 'i1',
        account_number: '4010',
        account_name: 'Sales',
        category: 'income',
        normal_balance: 'credit',
        total_debit: 0,
        total_credit: 1000,
        balance: 1000,
      },
      {
        account_id: 'e1',
        account_number: '5990',
        account_name: 'Expense',
        category: 'expense',
        normal_balance: 'debit',
        total_debit: 400,
        total_credit: 0,
        balance: 400,
      },
    ]);

    const report = await service.getProfitAndLoss(
      COMPANY_ID,
      '2026-01-01',
      '2026-12-31',
    );

    expect(report.total_income).toBe(1000);
    expect(report.total_expense).toBe(400);
    expect(report.net_profit).toBe(600);
  });

  it('summarizeProfitAndLoss mirrors YE category split', () => {
    const report = summarizeProfitAndLoss('2026-01-01', '2026-01-31', [
      {
        account_id: 'i1',
        account_number: '4010',
        account_name: 'Sales',
        category: 'income',
        normal_balance: 'credit',
        total_debit: 0,
        total_credit: 50,
        balance: 50,
      },
      {
        account_id: 'e1',
        account_number: '5100',
        account_name: 'COGS',
        category: 'expense',
        normal_balance: 'debit',
        total_debit: 20,
        total_credit: 0,
        balance: 20,
      },
    ]);
    expect(report.net_profit).toBe(30);
  });
});

describe('ReportsService (general ledger)', () => {
  const COMPANY_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const OTHER_COMPANY = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const ACCOUNT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  let repository: jest.Mocked<ReportsRepository>;
  let service: ReportsService;

  beforeEach(() => {
    repository = {
      findPeriodCompanyRow: jest.fn(),
      findAccountCompanyRow: jest.fn(),
      getTrialBalanceForPeriod: jest.fn().mockResolvedValue([]),
      getBalanceSheet: jest.fn().mockResolvedValue([]),
      getProfitAndLoss: jest.fn().mockResolvedValue([]),
      getGeneralLedger: jest.fn().mockResolvedValue([]),
      getCustomerLedger: jest.fn().mockResolvedValue([]),
      getAgedReceivables: jest.fn().mockResolvedValue([]),
      checkCustomerCreditLimit: jest.fn().mockResolvedValue({
        customer_id: '00000000-0000-0000-0000-000000000001',
        credit_limit: null,
        open_invoice_outstanding: 0,
        unapplied_advance_credit: 0,
        outstanding_balance: 0,
        exceeds_credit_limit: false,
        alert: null,
      }),
      getCustomerPaymentHistory: jest.fn().mockResolvedValue({
        customer_id: '00000000-0000-0000-0000-000000000001',
        invoice_count: 0,
        average_actual_days_to_pay: null,
        average_terms_days: null,
        invoices: [],
      }),
      findCustomerCompanyRow: jest.fn(),
      findSupplierCompanyRow: jest.fn(),
      getSupplierLedger: jest.fn().mockResolvedValue([]),
      getAgedPayables: jest.fn().mockResolvedValue([]),
      getBillsDue: jest.fn().mockResolvedValue([]),
      reconcileSupplierStatement: jest.fn().mockResolvedValue({}),
    };
    service = new ReportsService(repository);
  });

  it('rejects account belonging to another company', async () => {
    repository.findAccountCompanyRow.mockResolvedValue({
      id: ACCOUNT_ID,
      company_id: OTHER_COMPANY,
      account_number: '1020',
    });

    await expect(
      service.getGeneralLedger(COMPANY_ID, ACCOUNT_ID),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.getGeneralLedger).not.toHaveBeenCalled();
  });

  it('rejects inverted date range before RPC', async () => {
    await expect(
      service.getGeneralLedger(
        COMPANY_ID,
        undefined,
        '2026-06-01',
        '2026-05-01',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.getGeneralLedger).not.toHaveBeenCalled();
  });

  it('calls RPC when account belongs to company', async () => {
    repository.findAccountCompanyRow.mockResolvedValue({
      id: ACCOUNT_ID,
      company_id: COMPANY_ID,
      account_number: '1020',
    });

    await service.getGeneralLedger(
      COMPANY_ID,
      ACCOUNT_ID,
      '2026-01-01',
      '2026-01-31',
    );

    expect(repository.getGeneralLedger).toHaveBeenCalledWith(
      COMPANY_ID,
      ACCOUNT_ID,
      '2026-01-01',
      '2026-01-31',
    );
  });
});
