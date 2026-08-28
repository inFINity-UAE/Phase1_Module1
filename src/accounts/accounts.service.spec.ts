import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PostgrestError } from '@supabase/supabase-js';
import { ACCOUNTS_REPOSITORY, AccountsRepository } from './accounts.repository';
import { AccountsService } from './accounts.service';
import { JOURNAL_ENTRIES_REPOSITORY } from '../journal-entries/journal-entries.repository';
import { AccountCategory } from '../common/enums/account-category.enum';
import { NormalBalance } from '../common/enums/normal-balance.enum';
import { Account } from './entities/account.entity';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

const COMPANY_ID = '00000000-0000-0000-0000-000000000002';
const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111';

function pgError(code: string, message: string): PostgrestError {
  return { code, message, details: '', hint: '', name: 'PostgrestError' } as PostgrestError;
}

function sampleAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: ACCOUNT_ID,
    company_id: COMPANY_ID,
    account_number: '1998',
    account_name: 'Test Account',
    category: AccountCategory.Asset,
    sub_category: null,
    normal_balance: NormalBalance.Debit,
    parent_account_id: null,
    depth: 1,
    is_system_account: false,
    is_active: true,
    locked_at: null,
    locked_reason: null,
    description: null,
    created_at: '2026-08-22T00:00:00.000Z',
    updated_at: '2026-08-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('AccountsService', () => {
  let service: AccountsService;
  let repository: jest.Mocked<AccountsRepository>;
  let journalEntriesRepository: { getAccountTrialBalance: jest.Mock };

  beforeEach(async () => {
    repository = {
      insert: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      updateActive: jest.fn(),
      delete: jest.fn(),
    };
    journalEntriesRepository = {
      getAccountTrialBalance: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountsService,
        { provide: ACCOUNTS_REPOSITORY, useValue: repository },
        { provide: JOURNAL_ENTRIES_REPOSITORY, useValue: journalEntriesRepository },
      ],
    }).compile();

    service = module.get(AccountsService);
  });

  const validDto: CreateAccountDto = {
    company_id: COMPANY_ID,
    account_number: '1998',
    account_name: 'Test Account',
    category: AccountCategory.Asset,
    normal_balance: NormalBalance.Debit,
  };

  it('creating a valid account succeeds', async () => {
    const created = sampleAccount();
    repository.insert.mockResolvedValue(created);

    await expect(service.create(validDto)).resolves.toEqual(created);
    expect(repository.insert).toHaveBeenCalledWith(validDto);
  });

  it('creating an account with mismatched number/category prefix fails', async () => {
    repository.insert.mockRejectedValue(
      pgError(
        'P0001',
        'Account number 2999 does not match category asset (expected prefix 1)',
      ),
    );

    await expect(
      service.create({ ...validDto, account_number: '2999' }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.create({ ...validDto, account_number: '2999' }),
    ).rejects.toThrow(
      'Account number 2999 does not match category asset (expected prefix 1)',
    );
  });

  it('creating a 5th-level sub-account fails', async () => {
    repository.insert.mockRejectedValue(
      pgError('P0001', 'Sub-account hierarchy cannot exceed 4 levels deep'),
    );

    await expect(
      service.create({
        ...validDto,
        account_number: '1016',
        parent_account_id: '22222222-2222-2222-2222-222222222222',
        depth: 5,
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.create({
        ...validDto,
        account_number: '1016',
        parent_account_id: '22222222-2222-2222-2222-222222222222',
      }),
    ).rejects.toThrow('Sub-account hierarchy cannot exceed 4 levels deep');
  });

  it('creating with a cross-company parent_account_id fails (decision #45)', async () => {
    const parentId = '22222222-2222-2222-2222-222222222222';
    repository.insert.mockRejectedValue(
      pgError('P0001', `Parent account ${parentId} belongs to a different company`),
    );

    await expect(
      service.create({
        ...validDto,
        account_number: '1017',
        parent_account_id: parentId,
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.create({
        ...validDto,
        account_number: '1017',
        parent_account_id: parentId,
      }),
    ).rejects.toThrow(/belongs to a different company/i);
  });

  it('deactivating an account with no transactions succeeds', async () => {
    const active = sampleAccount({ is_active: true });
    const deactivated = sampleAccount({ is_active: false });
    repository.findById.mockResolvedValue(active);
    repository.updateActive.mockResolvedValue(deactivated);

    await expect(service.deactivate(ACCOUNT_ID)).resolves.toEqual(deactivated);
    expect(repository.updateActive).toHaveBeenCalledWith(ACCOUNT_ID, false);
  });

  it('attempting to delete an account that has journal_lines fails cleanly', async () => {
    repository.findById.mockResolvedValue(sampleAccount());
    repository.delete.mockRejectedValue(
      pgError(
        '23503',
        'update or delete on table "accounts" violates foreign key constraint "journal_lines_account_id_fkey" on table "journal_lines"',
      ),
    );

    await expect(service.remove(ACCOUNT_ID)).rejects.toThrow(ConflictException);
    await expect(service.remove(ACCOUNT_ID)).rejects.toThrow(
      'Account cannot be deleted because it has journal line transactions.',
    );
  });

  it('deactivate throws NotFoundException when account missing', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.deactivate(ACCOUNT_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('updating account_name on a non-system account succeeds', async () => {
    const active = sampleAccount();
    const updated = sampleAccount({ account_name: 'Renamed Account' });
    repository.findById.mockResolvedValue(active);
    repository.update.mockResolvedValue(updated);

    await expect(
      service.update(ACCOUNT_ID, { account_name: 'Renamed Account' }),
    ).resolves.toEqual(updated);
    expect(repository.update).toHaveBeenCalledWith(ACCOUNT_ID, {
      account_name: 'Renamed Account',
    });
  });

  it('updating a system account fails', async () => {
    repository.findById.mockResolvedValue(
      sampleAccount({
        account_number: '3100',
        account_name: 'Retained Earnings',
        is_system_account: true,
      }),
    );

    await expect(
      service.update(ACCOUNT_ID, { account_name: 'Renamed' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.update(ACCOUNT_ID, { account_name: 'Renamed' }),
    ).rejects.toThrow('is a system account and cannot be updated');
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('update throws BadRequestException when no fields provided', async () => {
    repository.findById.mockResolvedValue(sampleAccount());

    await expect(service.update(ACCOUNT_ID, {})).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.update(ACCOUNT_ID, {})).rejects.toThrow(
      'No updatable fields provided',
    );
    expect(repository.update).not.toHaveBeenCalled();
  });
});
