import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CustomersService } from './customers.service';
import { CUSTOMERS_REPOSITORY, CustomersRepository } from './customers.repository';
import { Customer } from './entities/customer.entity';

const COMPANY_ID = '00000000-0000-0000-0000-000000000002';
const CUSTOMER_ID = '44444444-4444-4444-4444-444444444444';

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: CUSTOMER_ID,
    company_id: COMPANY_ID,
    customer_name: 'Acme Trading LLC',
    trn: '100123456700003',
    email: 'billing@acme.test',
    phone: '+971500000000',
    billing_address: 'Dubai',
    default_payment_terms: 'net_30',
    is_active: true,
    created_at: '2026-08-31T00:00:00.000Z',
    updated_at: '2026-08-31T00:00:00.000Z',
    ...overrides,
  };
}

describe('CustomersService', () => {
  let service: CustomersService;
  let repository: jest.Mocked<CustomersRepository>;

  beforeEach(async () => {
    repository = {
      insert: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      updateActive: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: CUSTOMERS_REPOSITORY, useValue: repository },
      ],
    }).compile();

    service = module.get(CustomersService);
  });

  it('creates a customer', async () => {
    repository.insert.mockResolvedValue(customer());
    const result = await service.create({
      company_id: COMPANY_ID,
      customer_name: 'Acme Trading LLC',
      trn: '100123456700003',
    });
    expect(result.customer_name).toBe('Acme Trading LLC');
  });

  it('updates metadata fields only', async () => {
    repository.findById.mockResolvedValue(customer());
    repository.update.mockResolvedValue(customer({ customer_name: 'Acme Renamed' }));
    const result = await service.update(CUSTOMER_ID, { customer_name: 'Acme Renamed' });
    expect(result.customer_name).toBe('Acme Renamed');
    expect(repository.update).toHaveBeenCalledWith(CUSTOMER_ID, {
      customer_name: 'Acme Renamed',
    });
  });

  it('deactivates via is_active flag', async () => {
    repository.findById.mockResolvedValue(customer());
    repository.updateActive.mockResolvedValue(customer({ is_active: false }));
    const result = await service.deactivate(CUSTOMER_ID);
    expect(result.is_active).toBe(false);
  });
});

describe('CustomersService TRN uniqueness mapping', () => {
  let service: CustomersService;
  let repository: jest.Mocked<CustomersRepository>;

  beforeEach(async () => {
    repository = {
      insert: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      updateActive: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: CUSTOMERS_REPOSITORY, useValue: repository },
      ],
    }).compile();

    service = module.get(CustomersService);
  });

  it('maps duplicate TRN within company to ConflictException', async () => {
    repository.insert.mockRejectedValue({
      code: '23505',
      message: 'duplicate key value violates unique constraint "customers_company_trn_unique"',
    });

    await expect(
      service.create({
        company_id: COMPANY_ID,
        customer_name: 'Duplicate TRN',
        trn: '100123456700003',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
