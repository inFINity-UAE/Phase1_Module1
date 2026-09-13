import { CreateSupplierDto } from './dto/create-supplier.dto';
import { PaymentTermsType } from '../invoices/common/enums/payment-terms-type.enum';
import { Supplier } from './entities/supplier.entity';

export const SUPPLIERS_REPOSITORY = Symbol('SUPPLIERS_REPOSITORY');

/** Writable columns for PATCH /suppliers/:id — [feature-spec-1_1_E.md §3.1]. */
export interface UpdateSupplierRecord {
  supplier_name?: string;
  email?: string | null;
  phone?: string | null;
  billing_address?: string | null;
  default_payment_terms?: PaymentTermsType;
  custom_days?: number | null;
  bank_name?: string | null;
  iban?: string | null;
}

export interface SuppliersRepository {
  insert(dto: CreateSupplierDto): Promise<Supplier>;
  findAll(companyId: string): Promise<Supplier[]>;
  findById(id: string): Promise<Supplier | null>;
  update(id: string, patch: UpdateSupplierRecord): Promise<Supplier>;
  updateActive(id: string, isActive: boolean): Promise<Supplier>;
}
