import { ForbiddenException } from '@nestjs/common';
import { CompanyRole } from '../common/enums/company-role.enum';
import { VatService } from './vat.service';
import { VAT_REPOSITORY, VatRepository } from './vat.repository';

describe('VatService', () => {
  const repo: jest.Mocked<Pick<VatRepository, 'rpc' | 'findReturn'>> = {
    rpc: jest.fn(),
    findReturn: jest.fn(),
  };
  const service = new VatService(repo as unknown as VatRepository);

  beforeEach(() => {
    repo.rpc.mockReset();
    repo.findReturn.mockReset();
  });

  it('rejects non-Owner approve [F-8]', async () => {
    await expect(
      service.approve('11111111-1111-1111-1111-111111111111', 'u', CompanyRole.Accountant),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.rpc).not.toHaveBeenCalled();
  });

  it('Owner approve calls settle RPC [F-8 / F-31]', async () => {
    repo.rpc.mockResolvedValue({ status: 'approved' });
    await service.approve('11111111-1111-1111-1111-111111111111', 'owner', CompanyRole.Owner);
    expect(repo.rpc).toHaveBeenCalledWith('approve_vat_return', expect.any(Object));
  });

  it('rejects non-Owner file [F-8 / F-10]', async () => {
    await expect(
      service.file('11111111-1111-1111-1111-111111111111', 'u', CompanyRole.Accountant),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.rpc).not.toHaveBeenCalled();
  });

  it('rejects Viewer submit-for-review [F-8]', async () => {
    await expect(
      service.submitForReview(
        '11111111-1111-1111-1111-111111111111',
        'u',
        CompanyRole.Viewer,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.rpc).not.toHaveBeenCalled();
  });
});
