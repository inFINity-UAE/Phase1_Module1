import { Injectable } from '@nestjs/common';
import { PaymentTermsType } from '../invoices/common/enums/payment-terms-type.enum';
import { SupabaseService } from '../database/supabase.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { Supplier } from './entities/supplier.entity';
import { SuppliersRepository, UpdateSupplierRecord } from './suppliers.repository';

@Injectable()
export class SupabaseSuppliersRepository implements SuppliersRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async insert(dto: CreateSupplierDto): Promise<Supplier> {
    const { data, error } = await this.supabase.client
      .from('suppliers')
      .insert({
        company_id: dto.company_id,
        supplier_name: dto.supplier_name,
        trn: dto.trn ?? null,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        billing_address: dto.billing_address ?? null,
        default_payment_terms: dto.default_payment_terms ?? PaymentTermsType.Net30,
        custom_days: dto.custom_days ?? null,
        bank_name: dto.bank_name ?? null,
        iban: dto.iban ?? null,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;

    return data as Supplier;
  }

  async findAll(companyId: string): Promise<Supplier[]> {
    const { data, error } = await this.supabase.client
      .from('suppliers')
      .select('*')
      .eq('company_id', companyId)
      .order('supplier_name');

    if (error) throw error;

    return (data ?? []) as Supplier[];
  }

  async findById(id: string): Promise<Supplier | null> {
    const { data, error } = await this.supabase.client
      .from('suppliers')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;

    return data as Supplier | null;
  }

  async update(id: string, patch: UpdateSupplierRecord): Promise<Supplier> {
    const { data, error } = await this.supabase.client
      .from('suppliers')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return data as Supplier;
  }

  async updateActive(id: string, isActive: boolean): Promise<Supplier> {
    const { data, error } = await this.supabase.client
      .from('suppliers')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return data as Supplier;
  }
}
