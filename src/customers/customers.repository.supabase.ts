import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { Customer } from './entities/customer.entity';
import { CustomersRepository, UpdateCustomerRecord } from './customers.repository';

@Injectable()
export class SupabaseCustomersRepository implements CustomersRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async insert(dto: CreateCustomerDto): Promise<Customer> {
    const { data, error } = await this.supabase.client
      .from('customers')
      .insert({
        company_id: dto.company_id,
        customer_name: dto.customer_name,
        trn: dto.trn ?? null,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        billing_address: dto.billing_address ?? null,
        default_payment_terms: dto.default_payment_terms ?? null,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as Customer;
  }

  async findAll(companyId: string): Promise<Customer[]> {
    const { data, error } = await this.supabase.client
      .from('customers')
      .select('*')
      .eq('company_id', companyId)
      .order('customer_name');

    if (error) {
      throw error;
    }

    return (data ?? []) as Customer[];
  }

  async findById(id: string): Promise<Customer | null> {
    const { data, error } = await this.supabase.client
      .from('customers')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as Customer | null;
  }

  async update(id: string, patch: UpdateCustomerRecord): Promise<Customer> {
    const { data, error } = await this.supabase.client
      .from('customers')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as Customer;
  }

  async updateActive(id: string, isActive: boolean): Promise<Customer> {
    const { data, error } = await this.supabase.client
      .from('customers')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as Customer;
  }
}
