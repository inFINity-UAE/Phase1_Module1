import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PeriodStatus } from '../common/enums/period-status.enum';
import { AccountingPeriodsService } from './accounting-periods.service';
import {
  ACCOUNTING_PERIODS_REPOSITORY,
  AccountingPeriodsRepository,
} from './accounting-periods.repository';
import { AccountingPeriod } from './entities/accounting-period.entity';

const PERIOD_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const COMPANY_ID = '00000000-0000-0000-0000-000000000002';
const OTHER_COMPANY_ID = '00000000-0000-0000-0000-000000000099';

function openPeriod(overrides: Partial<AccountingPeriod> = {}): AccountingPeriod {
  return {
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
    ...overrides,
  };
}

describe('AccountingPeriodsService', () => {
  let service: AccountingPeriodsService;
  let repository: jest.Mocked<AccountingPeriodsRepository>;

  beforeEach(async () => {
    repository = {
      findById: jest.fn(),
      findByCompanyId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      hasOverlappingPeriod: jest.fn(),
      hasPostedJournalActivity: jest.fn(),
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

  describe('create', () => {
    it('creates an open period when the range is valid and non-overlapping', async () => {
      const created = openPeriod();
      repository.hasOverlappingPeriod.mockResolvedValue(false);
      repository.create.mockResolvedValue(created);

      const result = await service.create({
        company_id: COMPANY_ID,
        period_start: '2026-01-01',
        period_end: '2026-01-31',
        fiscal_year: 2026,
      });

      expect(repository.hasOverlappingPeriod).toHaveBeenCalledWith(
        COMPANY_ID,
        '2026-01-01',
        '2026-01-31',
      );
      expect(repository.create).toHaveBeenCalledWith({
        company_id: COMPANY_ID,
        period_start: '2026-01-01',
        period_end: '2026-01-31',
        fiscal_year: 2026,
      });
      expect(result).toEqual(created);
    });

    it('rejects overlapping periods for the same company', async () => {
      repository.hasOverlappingPeriod.mockResolvedValue(true);

      await expect(
        service.create({
          company_id: COMPANY_ID,
          period_start: '2026-01-15',
          period_end: '2026-02-15',
          fiscal_year: 2026,
        }),
      ).rejects.toThrow(ConflictException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('rejects period_end <= period_start', async () => {
      await expect(
        service.create({
          company_id: COMPANY_ID,
          period_start: '2026-01-31',
          period_end: '2026-01-01',
          fiscal_year: 2026,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.hasOverlappingPeriod).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('lists periods for the requested company chronologically', async () => {
      const rows = [
        openPeriod({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', period_start: '2026-01-01' }),
        openPeriod({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', period_start: '2026-02-01' }),
      ];
      repository.findByCompanyId.mockResolvedValue(rows);

      const result = await service.findAll(COMPANY_ID);

      expect(repository.findByCompanyId).toHaveBeenCalledWith(COMPANY_ID);
      expect(result).toEqual(rows);
    });

    it('requires company_id', async () => {
      await expect(service.findAll('')).rejects.toThrow(BadRequestException);
      expect(repository.findByCompanyId).not.toHaveBeenCalled();
    });

    it('does not return another company\'s periods (repo is company-scoped)', async () => {
      repository.findByCompanyId.mockResolvedValue([]);

      await service.findAll(OTHER_COMPANY_ID);

      expect(repository.findByCompanyId).toHaveBeenCalledWith(OTHER_COMPANY_ID);
      expect(repository.findByCompanyId).not.toHaveBeenCalledWith(COMPANY_ID);
    });
  });

  describe('update', () => {
    it('updates editable fields on an open unused period', async () => {
      repository.findById.mockResolvedValue(openPeriod());
      repository.hasPostedJournalActivity.mockResolvedValue(false);
      repository.hasOverlappingPeriod.mockResolvedValue(false);
      repository.update.mockResolvedValue(openPeriod({ fiscal_year: 2027 }));

      const result = await service.update(PERIOD_ID, { fiscal_year: 2027 });

      expect(repository.update).toHaveBeenCalledWith(PERIOD_ID, { fiscal_year: 2027 });
      expect(result.fiscal_year).toBe(2027);
    });

    it('rejects updates when the period is soft_closed', async () => {
      repository.findById.mockResolvedValue(
        openPeriod({ status: PeriodStatus.SoftClosed }),
      );

      await expect(service.update(PERIOD_ID, { fiscal_year: 2027 })).rejects.toThrow(
        /soft-close is the only status transition/i,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('rejects updates when the period has posted journal activity', async () => {
      repository.findById.mockResolvedValue(openPeriod());
      repository.hasPostedJournalActivity.mockResolvedValue(true);

      await expect(
        service.update(PERIOD_ID, { period_end: '2026-01-30' }),
      ).rejects.toThrow(ConflictException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('rejects date updates that would overlap another period', async () => {
      repository.findById.mockResolvedValue(openPeriod());
      repository.hasPostedJournalActivity.mockResolvedValue(false);
      repository.hasOverlappingPeriod.mockResolvedValue(true);

      await expect(
        service.update(PERIOD_ID, { period_end: '2026-03-31' }),
      ).rejects.toThrow(ConflictException);
      expect(repository.hasOverlappingPeriod).toHaveBeenCalledWith(
        COMPANY_ID,
        '2026-01-01',
        '2026-03-31',
        PERIOD_ID,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('softClose', () => {
    it('soft-close sets period status to soft_closed', async () => {
      const softClosed = openPeriod({
        status: PeriodStatus.SoftClosed,
        soft_closed_by: USER_ID,
        soft_closed_at: '2026-08-22T12:00:00.000Z',
      });

      repository.findById.mockResolvedValue(openPeriod());
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
});
