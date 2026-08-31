import { CreateCustomerDto } from './dto/create-customer.dto';
import { Customer } from './entities/customer.entity';

export const CUSTOMERS_REPOSITORY = Symbol('CUSTOMERS_REPOSITORY');

/** Writable columns for PATCH /customers/:id — [feature-spec-1.1.C.md decision #17]. */
export interface UpdateCustomerRecord {
  customer_name?: string;
  email?: string | null;
  phone?: string | null;
  billing_address?: string | null;
  default_payment_terms?: string | null;
}

export interface CustomersRepository {
  insert(dto: CreateCustomerDto): Promise<Customer>;
  findAll(companyId: string): Promise<Customer[]>;
  findById(id: string): Promise<Customer | null>;
  update(id: string, patch: UpdateCustomerRecord): Promise<Customer>;
  updateActive(id: string, isActive: boolean): Promise<Customer>;
}
