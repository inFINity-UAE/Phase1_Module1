import { ForbiddenException } from '@nestjs/common';
import { CompanyRole } from '../common/enums/company-role.enum';
import { CtService } from './ct.service';
import { CT_REPOSITORY, CtRepository } from './ct.repository';
import { CtIncomeAdjustmentType } from '../common/enums/ct-income-adjustment-type.enum';

describe('CtService', () => {
  const repo: jest.Mocked<Pick<CtRepository, 'rpc' | 'insertIncomeAdjustment'>> = {
    rpc: jest.fn(),
    insertIncomeAdjustment: jest.fn(),
  };
  const service = new CtService(repo as unknown as CtRepository);

  beforeEach(() => {
    repo.rpc.mockReset();
    repo.insertIncomeAdjustment.mockReset();
  });

  it('rejects non-Owner provision post [G-27 / F-8 analogue]', async () => {
    await expect(
      service.postProvision(
        { company_id: '11111111-1111-1111-1111-111111111111', fiscal_year: 2026 },
        'u',
        CompanyRole.Accountant,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.rpc).not.toHaveBeenCalled();
  });

  it('Owner post calls create_ct_provision_entry with created_by [G-27 / G-33]', async () => {
    repo.rpc.mockResolvedValue({ status: 'posted' });
    await service.postProvision(
      { company_id: '11111111-1111-1111-1111-111111111111', fiscal_year: 2026 },
      'owner',
      CompanyRole.Owner,
    );
    expect(repo.rpc).toHaveBeenCalledWith('create_ct_provision_entry', {
      p_company_id: '11111111-1111-1111-1111-111111111111',
      p_fiscal_year: 2026,
      p_created_by: 'owner',
    });
  });

  it('rejects Viewer calculate [G-27]', async () => {
    await expect(
      service.calculate(
        { company_id: '11111111-1111-1111-1111-111111111111', fiscal_year: 2026 },
        CompanyRole.Viewer,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.rpc).not.toHaveBeenCalled();
  });

  it('rejects automated add-back types on the manual POST [G-25]', async () => {
    await expect(
      service.createIncomeAdjustment(
        {
          company_id: '11111111-1111-1111-1111-111111111111',
          fiscal_year: 2026,
          adjustment_type: CtIncomeAdjustmentType.NonDeductibleEntertainment,
          amount: 50,
        },
        'u',
        CompanyRole.Owner,
      ),
    ).rejects.toThrow(/qualifying_dividend or intragroup_transaction/);
    expect(repo.insertIncomeAdjustment).not.toHaveBeenCalled();
  });
});
