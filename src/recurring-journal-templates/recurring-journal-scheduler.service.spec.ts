import { RecurringJournalSchedulerService } from './recurring-journal-scheduler.service';
import { RecurringJournalTemplatesService } from './recurring-journal-templates.service';
import { RecurringJournalTemplatesRepository } from './recurring-journal-templates.repository';
import { InvoicesRepository } from '../invoices/invoices.repository';
import { QuotationsRepository } from '../quotations/quotations.repository';

/**
 * [feature-spec.md decision #62] Unit coverage for multi-company iteration
 * and per-company failure isolation — does not call generate/run-due HTTP.
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
    Pick<InvoicesRepository, 'listCompanyIdsWithOpenInvoices' | 'markOverdueInvoices'>
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
    };
    scheduler = new RecurringJournalSchedulerService(
      templatesService as unknown as RecurringJournalTemplatesService,
      templatesRepository as unknown as RecurringJournalTemplatesRepository,
      quotationsRepository as unknown as QuotationsRepository,
      invoicesRepository as unknown as InvoicesRepository,
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
});
