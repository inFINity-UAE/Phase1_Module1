import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { handleDatabaseError } from '../common/errors/database-error.mapper';
import { PaymentTermsType } from '../invoices/common/enums/payment-terms-type.enum';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { Supplier } from './entities/supplier.entity';
import { SUPPLIERS_REPOSITORY, SuppliersRepository } from './suppliers.repository';

@Injectable()
export class SuppliersService {
  constructor(
    @Inject(SUPPLIERS_REPOSITORY)
    private readonly suppliersRepository: SuppliersRepository,
  ) {}

  /** [feature-spec-1_1_E.md §3.1] Create supplier for a company. */
  async create(dto: CreateSupplierDto): Promise<Supplier> {
    this.assertCustomDaysWhenRequired(dto.default_payment_terms, dto.custom_days);
    try {
      return await this.suppliersRepository.insert(dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findAll(companyId: string): Promise<Supplier[]> {
    try {
      return await this.suppliersRepository.findAll(companyId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findOne(id: string): Promise<Supplier> {
    try {
      const supplier = await this.suppliersRepository.findById(id);
      if (!supplier) throw new NotFoundException(`Supplier ${id} not found`);
      return supplier;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec-1_1_E.md §3.1] Metadata-only update — `trn` and
   * `company_id` are not patchable after creation.
   */
  async update(id: string, dto: UpdateSupplierDto): Promise<Supplier> {
    const current = await this.findOne(id);

    const hasPatch =
      dto.supplier_name !== undefined ||
      dto.email !== undefined ||
      dto.phone !== undefined ||
      dto.billing_address !== undefined ||
      dto.default_payment_terms !== undefined ||
      dto.custom_days !== undefined ||
      dto.bank_name !== undefined ||
      dto.iban !== undefined;
    if (!hasPatch) throw new BadRequestException('No updatable fields provided');

    const paymentTerms = dto.default_payment_terms ?? current.default_payment_terms;
    const customDays = dto.custom_days !== undefined ? dto.custom_days : current.custom_days;
    this.assertCustomDaysWhenRequired(paymentTerms, customDays);

    try {
      return await this.suppliersRepository.update(id, {
        ...(dto.supplier_name !== undefined ? { supplier_name: dto.supplier_name } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.billing_address !== undefined ? { billing_address: dto.billing_address } : {}),
        ...(dto.default_payment_terms !== undefined
          ? { default_payment_terms: dto.default_payment_terms }
          : {}),
        ...(dto.custom_days !== undefined ? { custom_days: dto.custom_days } : {}),
        ...(dto.bank_name !== undefined ? { bank_name: dto.bank_name } : {}),
        ...(dto.iban !== undefined ? { iban: dto.iban } : {}),
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec-1_1_E.md §3.1] Soft deactivate — never hard-delete.
   * New bills/POs against `is_active = false` are rejected; existing documents
   * are untouched.
   */
  async deactivate(id: string): Promise<Supplier> {
    await this.findOne(id);
    try {
      return await this.suppliersRepository.updateActive(id, false);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  private assertCustomDaysWhenRequired(
    paymentTerms: PaymentTermsType | undefined,
    customDays: number | null | undefined,
  ): void {
    if (paymentTerms === PaymentTermsType.Custom && (customDays == null || customDays < 1)) {
      throw new BadRequestException('custom_days is required when default_payment_terms is custom');
    }
  }
}
