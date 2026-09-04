import { RecurringJournalSchedulerService } from './recurring-journal-scheduler.service';
import { RecurringJournalTemplatesService } from './recurring-journal-templates.service';
import { RecurringJournalTemplatesRepository } from './recurring-journal-templates.repository';
import { InvoicesSchedulerService } from '../invoices/invoices-scheduler.service';
import { QuotationsSchedulerService } from '../quotations/quotations-scheduler.service';

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
  let quotationsScheduler: jest.Mocked<
    Pick<QuotationsSchedulerService, 'runScheduledExpirations'>
  >;
  let invoicesScheduler: jest.Mocked<
    Pick<InvoicesSchedulerService, 'runScheduledOverdueMarking'>
  >;
  let scheduler: RecurringJournalSchedulerService;

  beforeEach(() => {
    templatesService = {
      runDueGenerations: jest.fn(),
    };
    templatesRepository = {
      listCompanyIdsWithActiveTemplates: jest.fn(),
    };
    quotationsScheduler = {
      runScheduledExpirations: jest.fn().mockResolvedValue({
        companies_evaluated: 0,
        quotations_expired: 0,
        company_failures: [],
      }),
    };
    invoicesScheduler = {
      runScheduledOverdueMarking: jest.fn().mockResolvedValue({
        companies_evaluated: 0,
        invoices_marked_overdue: 0,
        company_failures: [],
      }),
    };
    scheduler = new RecurringJournalSchedulerService(
      templatesService as unknown as RecurringJournalTemplatesService,
      templatesRepository as unknown as RecurringJournalTemplatesRepository,
      quotationsScheduler as unknown as QuotationsSchedulerService,
      invoicesScheduler as unknown as InvoicesSchedulerService,
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
