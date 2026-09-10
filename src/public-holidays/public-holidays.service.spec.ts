import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CompanyRole } from '../common/enums/company-role.enum';
import { PublicHolidayStatus } from './common/enums/public-holiday-status.enum';
import { PublicHolidaysService } from './public-holidays.service';

describe('PublicHolidaysService', () => {
  const repo = {
    findAllForCompany: jest.fn(),
    findById: jest.fn(),
    insert: jest.fn(),
    updateDateAndConfirm: jest.fn(),
    delete: jest.fn(),
  };

  const service = new PublicHolidaysService(repo as never);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('PATCH moves date and confirms; rejects UAE-wide rows', async () => {
    repo.findById.mockResolvedValue({
      id: 'h1',
      company_id: 'c1',
      holiday_date: '2027-03-09',
      description: 'Eid Al Fitr',
      status: PublicHolidayStatus.Provisional,
      source: null,
    });
    repo.updateDateAndConfirm.mockResolvedValue({
      id: 'h1',
      company_id: 'c1',
      holiday_date: '2027-03-10',
      status: PublicHolidayStatus.Confirmed,
    });

    const updated = await service.update(
      'h1',
      { holiday_date: '2027-03-10' },
      CompanyRole.Accountant,
    );
    expect(updated.status).toBe(PublicHolidayStatus.Confirmed);
    expect(repo.updateDateAndConfirm).toHaveBeenCalledWith('h1', '2027-03-10');

    repo.findById.mockResolvedValue({
      id: 'uae',
      company_id: null,
      holiday_date: '2027-03-09',
      status: PublicHolidayStatus.Provisional,
    });
    await expect(
      service.update('uae', { holiday_date: '2027-03-10' }, CompanyRole.Owner),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non Owner/Accountant', () => {
    expect(() => service.findAll('c1', CompanyRole.Staff)).toThrow(ForbiddenException);
  });
});
