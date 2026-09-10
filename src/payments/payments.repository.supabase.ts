import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { PaymentApplication } from './entities/payment-application.entity';
import { PaymentWithApplications } from './entities/payment-with-applications.entity';
import { Payment } from './entities/payment.entity';
import { InsertPaymentParams, PaymentsRepository } from './payments.repository';

@Injectable()
export class SupabasePaymentsRepository implements PaymentsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async insertPayment(params: InsertPaymentParams): Promise<Payment> {
    const { data, error } = await this.supabase.client
      .from('payments')
      .insert({
        company_id: params.company_id,
        customer_id: params.customer_id,
        payment_date: params.payment_date,
        amount: params.amount,
        payment_method: params.payment_method ?? null,
        reference_number: params.reference_number ?? null,
        bank_account_id: params.bank_account_id ?? null,
        // Trigger trg_set_payment_unapplied_on_insert overwrites from amount.
        unapplied_amount: params.amount,
        created_by: params.created_by,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as Payment;
  }

  async findAll(companyId: string): Promise<Payment[]> {
    const { data, error } = await this.supabase.client
      .from('payments')
      .select('*')
      .eq('company_id', companyId)
      .order('payment_date', { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []) as Payment[];
  }

  async findByIdWithApplications(id: string): Promise<PaymentWithApplications | null> {
    const { data: payment, error: paymentError } = await this.supabase.client
      .from('payments')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (paymentError) {
      throw paymentError;
    }
    if (!payment) {
      return null;
    }

    const { data: applications, error: appError } = await this.supabase.client
      .from('payment_applications')
      .select('*')
      .eq('payment_id', id)
      .order('applied_at');

    if (appError) {
      throw appError;
    }

    return {
      payment: payment as Payment,
      applications: (applications ?? []) as PaymentApplication[],
    };
  }

  async updatePayment(id: string, patch: UpdatePaymentDto): Promise<Payment> {
    const { data, error } = await this.supabase.client
      .from('payments')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as Payment;
  }

  async deletePayment(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('payments').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }

  async insertApplication(params: {
    payment_id: string;
    invoice_id: string;
    applied_amount: number;
    applied_by: string;
  }): Promise<PaymentApplication> {
    const { data, error } = await this.supabase.client
      .from('payment_applications')
      .insert({
        payment_id: params.payment_id,
        invoice_id: params.invoice_id,
        applied_amount: params.applied_amount,
        applied_by: params.applied_by,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as PaymentApplication;
  }

  async deleteApplication(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('payment_applications')
      .delete()
      .eq('id', id);
    if (error) {
      throw error;
    }
  }

  async findApplicationById(id: string): Promise<PaymentApplication | null> {
    const { data, error } = await this.supabase.client
      .from('payment_applications')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data as PaymentApplication | null) ?? null;
  }

  async findPaymentIdByApplicationId(id: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('payment_applications')
      .select('payment_id')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data?.payment_id as string | undefined) ?? null;
  }

  async findCustomerCompanyId(customerId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('customers')
      .select('company_id')
      .eq('id', customerId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data?.company_id as string | undefined) ?? null;
  }

  async findCustomerActive(customerId: string): Promise<boolean | null> {
    const { data, error } = await this.supabase.client
      .from('customers')
      .select('is_active')
      .eq('id', customerId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }

    return Boolean(data.is_active);
  }

  async postPaymentJournal(
    paymentId: string,
    createdBy: string,
  ): Promise<{ journal_entry_id: string; entry_type: string }> {
    const { data, error } = await this.supabase.client.rpc('create_payment_journal_entry', {
      p_payment_id: paymentId,
      p_created_by: createdBy,
    });

    if (error) {
      throw error;
    }

    const result = data as { journal_entry_id: string; entry_type: string };
    return {
      journal_entry_id: result.journal_entry_id,
      entry_type: result.entry_type,
    };
  }

  async postAdvanceApplicationJournal(
    paymentApplicationId: string,
    createdBy: string,
  ): Promise<{ journal_entry_id: string }> {
    const { data, error } = await this.supabase.client.rpc(
      'create_advance_application_journal_entry',
      {
        p_payment_application_id: paymentApplicationId,
        p_created_by: createdBy,
      },
    );

    if (error) {
      throw error;
    }

    const result = data as { journal_entry_id: string };
    return { journal_entry_id: result.journal_entry_id };
  }
}
