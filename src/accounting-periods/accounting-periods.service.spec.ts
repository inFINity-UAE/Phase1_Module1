import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PeriodStatus } from '../common/enums/period-status.enum';
import { AccountingPeriodsService } from './accounting-periods.service';
import {
  ACCOUNTING_PERIODS_REPOSITORY,
  AccountingPeriodsRepository,
} from './accounting-periods.repository';

const PERIOD_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const COMPANY_ID = '00000000-0000-0000-0000-000000000002';

describe('AccountingPeriodsService', () => {
  let service: AccountingPeriodsService;
  let repository: jest.Mocked<AccountingPeriodsRepository>;

  beforeEach(async () => {
    repository = {
      findById: jest.fn(),
      softClose: jest.fn(),
      logSoftClosedPostingOverride: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountingPeriodsService,
        { provide: ACCOUNTING_PERIODS_REPOSITORY, useValue: repository },
      ],
    }).compile();

    service = module.get(AccountingPeriodsService);
  });

  it('soft-close sets period status to soft_closed', async () => {
    const openPeriod = {
      id: PERIOD_ID,
      company_id: COMPANY_ID,
      period_start: '2026-01-01',
      period_end: '2026-01-31',
      fiscal_year: 2026,
      status: PeriodStatus.Open,
      soft_closed_by: null,
      soft_closed_at: null,
      closed_by: null,
      closed_at: null,
      reopened_by: null,
      reopened_at: null,
      reopen_reason: null,
      created_at: '2026-08-22T00:00:00.000Z',
    };
    const softClosed = {
      ...openPeriod,
      status: PeriodStatus.SoftClosed,
      soft_closed_by: USER_ID,
      soft_closed_at: '2026-08-22T12:00:00.000Z',
    };

    repository.findById.mockResolvedValue(openPeriod);
    repository.softClose.mockResolvedValue(softClosed);

    const result = await service.softClose(PERIOD_ID, USER_ID);

    expect(repository.softClose).toHaveBeenCalledWith(PERIOD_ID, USER_ID);
    expect(result.status).toBe(PeriodStatus.SoftClosed);
  });

  it('soft-close throws NotFoundException when period missing', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.softClose(PERIOD_ID, USER_ID)).rejects.toThrow(
      NotFoundException,
    );
  });
});
