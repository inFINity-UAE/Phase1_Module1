import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { CreateSupplierPaymentRunItemDto } from './dto/create-supplier-payment-run.dto';
import { CreateSupplierStatementLineDto } from './dto/create-supplier-statement-line.dto';
import { UpdateSupplierPaymentDto } from './dto/update-supplier-payment.dto';
import { UpdateSupplierStatementLineDto } from './dto/update-supplier-statement-line.dto';
import { PaymentRunStatus } from './common/enums/payment-run-status.enum';
import { SupplierPaymentApplication } from './entities/supplier-payment-application.entity';
import { SupplierPaymentRunItem } from './entities/supplier-payment-run-item.entity';
import { SupplierPaymentRunWithItems } from './entities/supplier-payment-run-with-items.entity';
import { SupplierPaymentRun } from './entities/supplier-payment-run.entity';
import { SupplierPaymentWithApplications } from './entities/supplier-payment-with-applications.entity';
import { SupplierPayment } from './entities/supplier-payment.entity';
import { SupplierStatementLine } from './entities/supplier-statement-line.entity';
import {
  InsertSupplierPaymentParams,
  SupplierPaymentsRepository,
} from './supplier-payments.repository';

@Injectable()
export class SupabaseSupplierPaymentsRepository implements SupplierPaymentsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async insertPayment(params: InsertSupplierPaymentParams): Promise<SupplierPayment> {
    const { data, error } = await this.supabase.client
      .from('supplier_payments')
      .insert({
        company_id: params.company_id,
        supplier_id: params.supplier_id,
        payment_date: params.payment_date,
        amount: params.amount,
        payment_method: params.payment_method ?? null,
        reference_number: params.reference_number ?? null,
        bank_account_id: params.bank_account_id ?? null,
        unapplied_amount: params.amount,
        created_by: params.created_by,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }
    return data as SupplierPayment;
  }

  async findAllPayments(companyId: string): Promise<SupplierPayment[]> {
    const { data, error } = await this.supabase.client
      .from('supplier_payments')
      .select('*')
      .eq('company_id', companyId)
      .order('payment_date', { ascending: false });
    if (error) {
      throw error;
    }
    return (data ?? []) as SupplierPayment[];
  }

  async findPaymentByIdWithApplications(
    id: string,
  ): Promise<SupplierPaymentWithApplications | null> {
    const { data: payment, error: paymentError } = await this.supabase.client
      .from('supplier_payments')
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
      .from('supplier_payment_applications')
      .select('*')
      .eq('supplier_payment_id', id)
      .order('applied_at');
    if (appError) {
      throw appError;
    }

    return {
      payment: payment as SupplierPayment,
      applications: (applications ?? []) as SupplierPaymentApplication[],
    };
  }

  async updatePayment(id: string, patch: UpdateSupplierPaymentDto): Promise<SupplierPayment> {
    const { data, error } = await this.supabase.client
      .from('supplier_payments')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) {
      throw error;
    }
    return data as SupplierPayment;
  }

  async deletePayment(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('supplier_payments').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }

  async insertApplication(params: {
    supplier_payment_id: string;
    bill_id: string;
    applied_amount: number;
    applied_by: string;
  }): Promise<SupplierPaymentApplication> {
    const { data, error } = await this.supabase.client
      .from('supplier_payment_applications')
      .insert({
        supplier_payment_id: params.supplier_payment_id,
        bill_id: params.bill_id,
        applied_amount: params.applied_amount,
        applied_by: params.applied_by,
      })
      .select()
      .single();
    if (error) {
      throw error;
    }
    return data as SupplierPaymentApplication;
  }

  async deleteApplication(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('supplier_payment_applications')
      .delete()
      .eq('id', id);
    if (error) {
      throw error;
    }
  }

  async findApplicationById(id: string): Promise<SupplierPaymentApplication | null> {
    const { data, error } = await this.supabase.client
      .from('supplier_payment_applications')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return (data as SupplierPaymentApplication | null) ?? null;
  }

  async findSupplierCompanyId(supplierId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('suppliers')
      .select('company_id')
      .eq('id', supplierId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return (data?.company_id as string | undefined) ?? null;
  }

  async findSupplierActive(supplierId: string): Promise<boolean | null> {
    const { data, error } = await this.supabase.client
      .from('suppliers')
      .select('is_active')
      .eq('id', supplierId)
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
  ): Promise<{ journal_entry_id: string }> {
    const { data, error } = await this.supabase.client.rpc(
      'create_supplier_payment_journal_entry',
      { p_payment_id: paymentId, p_created_by: createdBy },
    );
    if (error) {
      throw error;
    }
    return { journal_entry_id: (data as { journal_entry_id: string }).journal_entry_id };
  }

  async postAdvanceApplicationJournal(
    applicationId: string,
    createdBy: string,
  ): Promise<{ journal_entry_id: string }> {
    const { data, error } = await this.supabase.client.rpc(
      'create_supplier_advance_application_journal_entry',
      { p_application_id: applicationId, p_created_by: createdBy },
    );
    if (error) {
      throw error;
    }
    return { journal_entry_id: (data as { journal_entry_id: string }).journal_entry_id };
  }

  async insertRun(params: {
    company_id: string;
    run_date: string;
    payment_method: string;
    bank_account_id?: string | null;
    created_by: string;
  }): Promise<SupplierPaymentRun> {
    const { data, error } = await this.supabase.client
      .from('supplier_payment_runs')
      .insert({
        company_id: params.company_id,
        run_date: params.run_date,
        payment_method: params.payment_method,
        bank_account_id: params.bank_account_id ?? null,
        created_by: params.created_by,
        status: PaymentRunStatus.Draft,
      })
      .select()
      .single();
    if (error) {
      throw error;
    }
    return data as SupplierPaymentRun;
  }

  async insertRunItem(
    runId: string,
    item: CreateSupplierPaymentRunItemDto,
  ): Promise<SupplierPaymentRunItem> {
    const { data, error } = await this.supabase.client
      .from('supplier_payment_run_items')
      .insert({
        run_id: runId,
        bill_id: item.bill_id,
        supplier_id: item.supplier_id,
        amount_to_pay: item.amount_to_pay,
        included: item.included ?? true,
      })
      .select()
      .single();
    if (error) {
      throw error;
    }
    return data as SupplierPaymentRunItem;
  }

  async findAllRuns(companyId: string): Promise<SupplierPaymentRun[]> {
    const { data, error } = await this.supabase.client
      .from('supplier_payment_runs')
      .select('*')
      .eq('company_id', companyId)
      .order('run_date', { ascending: false });
    if (error) {
      throw error;
    }
    return (data ?? []) as SupplierPaymentRun[];
  }

  async findRunByIdWithItems(id: string): Promise<SupplierPaymentRunWithItems | null> {
    const { data: run, error: runError } = await this.supabase.client
      .from('supplier_payment_runs')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (runError) {
      throw runError;
    }
    if (!run) {
      return null;
    }
    const { data: items, error: itemsError } = await this.supabase.client
      .from('supplier_payment_run_items')
      .select('*')
      .eq('run_id', id);
    if (itemsError) {
      throw itemsError;
    }
    return {
      run: run as SupplierPaymentRun,
      items: (items ?? []) as SupplierPaymentRunItem[],
    };
  }

  async updateRun(
    id: string,
    patch: Partial<
      Pick<
        SupplierPaymentRun,
        'status' | 'approved_by' | 'executed_at' | 'run_date' | 'payment_method' | 'bank_account_id'
      >
    >,
  ): Promise<SupplierPaymentRun> {
    const { data, error } = await this.supabase.client
      .from('supplier_payment_runs')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) {
      throw error;
    }
    return data as SupplierPaymentRun;
  }

  async deleteRun(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('supplier_payment_runs').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }

  async executeRun(runId: string, createdBy: string): Promise<unknown> {
    const { data, error } = await this.supabase.client.rpc('execute_supplier_payment_run', {
      p_run_id: runId,
      p_created_by: createdBy,
    });
    if (error) {
      throw error;
    }
    return data;
  }

  async insertStatementLine(dto: CreateSupplierStatementLineDto): Promise<SupplierStatementLine> {
    const { data, error } = await this.supabase.client
      .from('supplier_statement_lines')
      .insert({
        company_id: dto.company_id,
        supplier_id: dto.supplier_id,
        statement_date: dto.statement_date,
        line_date: dto.line_date,
        line_type: dto.line_type,
        reference: dto.reference ?? null,
        amount: dto.amount,
        source: dto.source ?? 'manual',
      })
      .select()
      .single();
    if (error) {
      throw error;
    }
    return data as SupplierStatementLine;
  }

  async findAllStatementLines(companyId: string): Promise<SupplierStatementLine[]> {
    const { data, error } = await this.supabase.client
      .from('supplier_statement_lines')
      .select('*')
      .eq('company_id', companyId)
      .order('line_date', { ascending: false });
    if (error) {
      throw error;
    }
    return (data ?? []) as SupplierStatementLine[];
  }

  async updateStatementLine(
    id: string,
    patch: UpdateSupplierStatementLineDto,
  ): Promise<SupplierStatementLine> {
    const { data, error } = await this.supabase.client
      .from('supplier_statement_lines')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) {
      throw error;
    }
    return data as SupplierStatementLine;
  }

  async findStatementLineById(id: string): Promise<SupplierStatementLine | null> {
    const { data, error } = await this.supabase.client
      .from('supplier_statement_lines')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return data as SupplierStatementLine | null;
  }

  async confirmStatementMatch(
    id: string,
    patch: {
      matched_bill_id?: string | null;
      matched_payment_id?: string | null;
      match_status: string;
    },
  ): Promise<SupplierStatementLine> {
    const { data, error } = await this.supabase.client
      .from('supplier_statement_lines')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) {
      throw error;
    }
    return data as SupplierStatementLine;
  }

  async deleteStatementLine(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('supplier_statement_lines')
      .delete()
      .eq('id', id);
    if (error) {
      throw error;
    }
  }
}
