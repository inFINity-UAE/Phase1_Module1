import { RecurringJournalSchedulerService } from './recurring-journal-scheduler.service';
import { RecurringJournalTemplatesService } from './recurring-journal-templates.service';
import { RecurringJournalTemplatesRepository } from './recurring-journal-templates.repository';
import { AccountingPeriodsRepository } from '../accounting-periods/accounting-periods.repository';
import { CompanyMembersService } from '../company-members/company-members.service';
import { InvoicesRepository } from '../invoices/invoices.repository';
import { QuotationsRepository } from '../quotations/quotations.repository';

/**
 * [feature-spec.md decision #62] + [feature-spec-1_1_D.md §4.5a / §4.5b]
 * Multi-company iteration and per-company failure isolation.
 */
describe('RecurringJournalSchedulerService (decision #62)', () => {
  const COMPANY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const COMPANY_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const AS_OF = '2026-01-31';

  let templatesService: jest.Mocked<
    Pick<RecurringJournalTemplatesService, 'runDueGenerations'>
  >;
  let templatesRepository: jest.Mocked<
    Pick<RecurringJournalTemplatesRepository, 'listCompanyIdsWithActiveTemplates'>
  >;
  let quotationsRepository: jest.Mocked<
    Pick<QuotationsRepository, 'listCompanyIdsWithOpenQuotations' | 'expireDueQuotations'>
  >;
  let invoicesRepository: jest.Mocked<
    Pick<
      InvoicesRepository,
      | 'listCompanyIdsWithOpenInvoices'
      | 'markOverdueInvoices'
      | 'listCompanyIdsWithUnflaggedWriteOffs'
      | 'markVatReliefEligible'
    >
  >;
  let accountingPeriodsRepository: jest.Mocked<
    Pick<
      AccountingPeriodsRepository,
      'listPeriodsPendingEcl' | 'addBusinessDays' | 'runEclProvision'
    >
  >;
  let companyMembersService: jest.Mocked<
    Pick<CompanyMembersService, 'findOwnerUserId'>
  >;
  let scheduler: RecurringJournalSchedulerService;

  beforeEach(() => {
    templatesService = {
      runDueGenerations: jest.fn(),
    };
    templatesRepository = {
      listCompanyIdsWithActiveTemplates: jest.fn(),
    };
    quotationsRepository = {
      listCompanyIdsWithOpenQuotations: jest.fn(),
      expireDueQuotations: jest.fn(),
    };
    invoicesRepository = {
      listCompanyIdsWithOpenInvoices: jest.fn(),
      markOverdueInvoices: jest.fn(),
      listCompanyIdsWithUnflaggedWriteOffs: jest.fn(),
      markVatReliefEligible: jest.fn(),
    };
    accountingPeriodsRepository = {
      listPeriodsPendingEcl: jest.fn(),
      addBusinessDays: jest.fn(),
      runEclProvision: jest.fn(),
    };
    companyMembersService = {
      findOwnerUserId: jest.fn(),
    };
    scheduler = new RecurringJournalSchedulerService(
      templatesService as unknown as RecurringJournalTemplatesService,
      templatesRepository as unknown as RecurringJournalTemplatesRepository,
      quotationsRepository as unknown as QuotationsRepository,
      invoicesRepository as unknown as InvoicesRepository,
      accountingPeriodsRepository as unknown as AccountingPeriodsRepository,
      companyMembersService as unknown as CompanyMembersService,
    );
  });

  it('runs runDueGenerations for every company with an active template', async () => {
    templatesRepository.listCompanyIdsWithActiveTemplates.mockResolvedValue([
      COMPANY_A,
      COMPANY_B,
    ]);
    templatesService.runDueGenerations
      .mockResolvedValueOnce([
        {
          template_id: 't1',
          template_name: 'A',
          journal_entry: { entry: { id: 'e1' } } as never,
          posted: true,
          next_run_date: '2026-02-28',
        },
      ])
      .mockResolvedValueOnce([
        {
          template_id: 't2',
          template_name: 'B',
          journal_entry: { entry: { id: 'e2' } } as never,
          posted: true,
          next_run_date: '2026-02-28',
        },
      ]);

    const summary = await scheduler.runScheduledDueGenerations(AS_OF);

    expect(templatesService.runDueGenerations).toHaveBeenCalledWith(
      COMPANY_A,
      AS_OF,
    );
    expect(templatesService.runDueGenerations).toHaveBeenCalledWith(
      COMPANY_B,
      AS_OF,
    );
    expect(summary.companies_evaluated).toBe(2);
    expect(summary.templates_evaluated).toBe(2);
    expect(summary.entries_generated).toBe(2);
    expect(summary.company_failures).toEqual([]);
  });

  it('isolates one company failure and continues the loop', async () => {
    templatesRepository.listCompanyIdsWithActiveTemplates.mockResolvedValue([
      COMPANY_A,
      COMPANY_B,
    ]);
    templatesService.runDueGenerations
      .mockRejectedValueOnce(new Error('company A boom'))
      .mockResolvedValueOnce([
        {
          template_id: 't2',
          template_name: 'B',
          journal_entry: { entry: { id: 'e2' } } as never,
          posted: true,
          next_run_date: '2026-02-28',
        },
      ]);

    const summary = await scheduler.runScheduledDueGenerations(AS_OF);

    expect(summary.company_failures).toEqual([
      { company_id: COMPANY_A, error: 'company A boom' },
    ]);
    expect(summary.entries_generated).toBe(1);
    expect(templatesService.runDueGenerations).toHaveBeenCalledTimes(2);
  });

  it('skips companies with no active templates (empty company list)', async () => {
    templatesRepository.listCompanyIdsWithActiveTemplates.mockResolvedValue([]);

    const summary = await scheduler.runScheduledDueGenerations(AS_OF);

    expect(templatesService.runDueGenerations).not.toHaveBeenCalled();
    expect(summary.companies_evaluated).toBe(0);
    expect(summary.entries_generated).toBe(0);
  });

  it('§4.5b flags VAT relief for companies with unflagged write-offs', async () => {
    invoicesRepository.listCompanyIdsWithUnflaggedWriteOffs.mockResolvedValue([
      COMPANY_A,
    ]);
    invoicesRepository.markVatReliefEligible.mockResolvedValue(2);

    const summary = await scheduler.runScheduledVatReliefFlagging('2026-09-01');

    expect(invoicesRepository.markVatReliefEligible).toHaveBeenCalledWith(
      COMPANY_A,
      '2026-09-01',
    );
    expect(summary.write_offs_flagged).toBe(2);
  });

  it('§4.5a / D-10 runs ECL when as_of >= period_end + 5 business days; skips early', async () => {
    accountingPeriodsRepository.listPeriodsPendingEcl.mockResolvedValue([
      { company_id: COMPANY_A, period_end: '2026-01-31' },
      { company_id: COMPANY_B, period_end: '2026-01-31' },
    ]);
    accountingPeriodsRepository.addBusinessDays
      .mockResolvedValueOnce('2026-02-06') // A due
      .mockResolvedValueOnce('2026-02-06'); // B not yet if as_of is before
    companyMembersService.findOwnerUserId.mockResolvedValue('owner-a');
    accountingPeriodsRepository.runEclProvision.mockResolvedValue({
      journal_entry_id: 'je-1',
    });

    const early = await scheduler.runScheduledEclProvisioning('2026-02-05');
    expect(early.runs_completed).toBe(0);
    expect(accountingPeriodsRepository.runEclProvision).not.toHaveBeenCalled();

    accountingPeriodsRepository.addBusinessDays
      .mockResolvedValueOnce('2026-02-06')
      .mockResolvedValueOnce('2026-02-06');
    companyMembersService.findOwnerUserId
      .mockResolvedValueOnce('owner-a')
      .mockResolvedValueOnce('owner-b');

    const due = await scheduler.runScheduledEclProvisioning('2026-02-06');
    expect(due.runs_completed).toBe(2);
    expect(accountingPeriodsRepository.runEclProvision).toHaveBeenCalledWith(
      COMPANY_A,
      '2026-01-31',
      'owner-a',
    );
    expect(accountingPeriodsRepository.runEclProvision).toHaveBeenCalledWith(
      COMPANY_B,
      '2026-01-31',
      'owner-b',
    );
  });

  it('§4.5a treats ECL_PROVISION_ALREADY_RUN as non-failure (catch-up race)', async () => {
    accountingPeriodsRepository.listPeriodsPendingEcl.mockResolvedValue([
      { company_id: COMPANY_A, period_end: '2026-01-31' },
    ]);
    accountingPeriodsRepository.addBusinessDays.mockResolvedValue('2026-02-06');
    companyMembersService.findOwnerUserId.mockResolvedValue('owner-a');
    accountingPeriodsRepository.runEclProvision.mockRejectedValue(
      new Error('ECL_PROVISION_ALREADY_RUN'),
    );

    const summary = await scheduler.runScheduledEclProvisioning('2026-02-10');
    expect(summary.runs_completed).toBe(0);
    expect(summary.failures).toEqual([]);
  });
});
