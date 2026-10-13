import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { handleDatabaseError } from '../common/errors/database-error.mapper';
import { CUSTOMERS_REPOSITORY, CustomersRepository } from './customers.repository';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { Customer } from './entities/customer.entity';

@Injectable()
export class CustomersService {
  constructor(
    @Inject(CUSTOMERS_REPOSITORY)
    private readonly customersRepository: CustomersRepository,
  ) {}

  /** [feature-spec-1_1_C.md §1.1] Create customer for a company. */
  async create(dto: CreateCustomerDto): Promise<Customer> {
    try {
      return await this.customersRepository.insert(dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findAll(companyId: string): Promise<Customer[]> {
    try {
      return await this.customersRepository.findAll(companyId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findOne(id: string): Promise<Customer> {
    try {
      const customer = await this.customersRepository.findById(id);
      if (!customer) throw new NotFoundException(`Customer ${id} not found`);
      return customer;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec-1_1_C.md decision #17] Metadata-only update — `trn` and
   * `company_id` are not patchable after creation.
   */
  async update(id: string, dto: UpdateCustomerDto): Promise<Customer> {
    await this.findOne(id);

    const hasPatch =
      dto.customer_name !== undefined ||
      dto.email !== undefined ||
      dto.phone !== undefined ||
      dto.billing_address !== undefined ||
      dto.default_payment_terms !== undefined;
    if (!hasPatch) throw new BadRequestException('No updatable fields provided');

    try {
      return await this.customersRepository.update(id, {
        ...(dto.customer_name !== undefined ? { customer_name: dto.customer_name } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.billing_address !== undefined ? { billing_address: dto.billing_address } : {}),
        ...(dto.default_payment_terms !== undefined
          ? { default_payment_terms: dto.default_payment_terms }
          : {}),
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec-1_1_C.md §1.1] Soft deactivate — never hard-delete.
   * Future quotation/invoice modules must reject new documents referencing
   * `is_active = false` customers; existing documents are untouched.
   */
  async deactivate(id: string): Promise<Customer> {
    await this.findOne(id);
    try {
      return await this.customersRepository.updateActive(id, false);
    } catch (error) {
      handleDatabaseError(error);
    }
  }
}
