import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { Test, TestingModule } from '@nestjs/testing';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { CustomersModule } from '../customers/customers.module';
import { CustomersService } from '../customers/customers.service';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import { getAccountIdByNumber } from '../e2e/e2e-company.setup';
import { InvoiceStatus } from '../invoices/common/enums/invoice-status.enum';
import { PaymentTermsType } from '../invoices/common/enums/payment-terms-type.enum';
import { InvoicesModule } from '../invoices/invoices.module';
import { InvoicesService } from '../invoices/invoices.service';
import {
  INTEGRATION_USER_ID,
  mintFreshIntegrationCompany,
} from '../test/integration-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const USER_ID = INTEGRATION_USER_ID;
const PAYMENT_DATE = '2026-06-15';

/**
 * [feature-spec-1_1_D.md §4.2 / §4.3 / D-1 / D-12]
 * create_payment_journal_entry + create_advance_application_journal_entry.
 */
(hasSupabase ? describe : describe.skip)(
  'Payment journal posting (feature-spec-1_1_D.md §4.2 / §4.3)',
  () => {
    jest.setTimeout(180_000);

    let invoicesService: InvoicesService;
    let customersService: CustomersService;
    let supabase: SupabaseService;
    let companyId = '';
    let customerId = '';
    let incomeAccountId = '';
    let account1010 = '';
    let account1020 = '';
    let account1070 = '';
    let account1100 = '';
    let account2060 = '';
    const paymentIds: string[] = [];
    const invoiceIds: string[] = [];

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, CustomersModule, InvoicesModule],
      }).compile();

      invoicesService = module.get(InvoicesService);
      customersService = module.get(CustomersService);
      supabase = module.get(SupabaseService);

      companyId = await mintFreshIntegrationCompany(supabase, 'Payment JE');
      const customer = await customersService.create({
        company_id: companyId,
        customer_name: 'Payment JE customer',
      });
      customerId = customer.id;

      incomeAccountId = await getAccountIdByNumber(supabase, companyId, '4000');
      account1010 = await getAccountIdByNumber(supabase, companyId, '1010');
      account1020 = await getAccountIdByNumber(supabase, companyId, '1020');
      account1070 = await getAccountIdByNumber(supabase, companyId, '1070');
      account1100 = await getAccountIdByNumber(supabase, companyId, '1100');
      account2060 = await getAccountIdByNumber(supabase, companyId, '2060');
    }, 120_000);

    afterAll(async () => {
      for (const id of paymentIds) {
        await supabase.client.from('payment_applications').delete().eq('payment_id', id);
        await supabase.client.from('payments').delete().eq('id', id);
      }
      for (const id of invoiceIds) {
        await supabase.client.from('invoice_lines').delete().eq('invoice_id', id);
        await supabase.client.from('invoices').delete().eq('id', id);
      }
      if (customerId) {
        await supabase.client.from('customers').delete().eq('id', customerId);
      }
    });

    async function createIssuedInvoice(): Promise<string> {
      const created = await invoicesService.create(
        {
          company_id: companyId,
          customer_id: customerId,
          invoice_date: '2026-06-01',
          payment_terms: PaymentTermsType.Net30,
          lines: [
            {
              line_number: 1,
              description: 'Service',
              quantity: 1,
              unit_price: 1000,
              vat_rate: 5,
              is_service: true,
              income_account_id: incomeAccountId,
            },
          ],
        },
        USER_ID,
      );
      invoiceIds.push(created.invoice.id);
      const issued = await invoicesService.issue(created.invoice.id);
      expect(issued.invoice.status).toBe(InvoiceStatus.Issued);
      return issued.invoice.id;
    }

    async function insertPayment(params: {
      amount: number;
      method: string;
      bankAccountId?: string | null;
    }): Promise<string> {
      const { data, error } = await supabase.client
        .from('payments')
        .insert({
          company_id: companyId,
          customer_id: customerId,
          payment_date: PAYMENT_DATE,
          amount: params.amount,
          payment_method: params.method,
          bank_account_id: params.bankAccountId ?? null,
          unapplied_amount: params.amount,
          created_by: USER_ID,
        })
        .select('id, unapplied_amount')
        .single();
      expect(error).toBeNull();
      expect(Number(data!.unapplied_amount)).toBe(params.amount);
      paymentIds.push(data!.id);
      return data!.id;
    }

    async function journalLines(journalEntryId: string) {
      const { data, error } = await supabase.client
        .from('journal_lines')
        .select('account_id, debit, credit, line_number')
        .eq('journal_entry_id', journalEntryId)
        .order('line_number');
      expect(error).toBeNull();
      return data!;
    }

    it('§4.2 posts customer_payment Dr routed bank / Cr 1100 when applications exist', async () => {
      const invoiceId = await createIssuedInvoice();
      const paymentId = await insertPayment({ amount: 500, method: 'bank_transfer' });

      const { error: appErr } = await supabase.client.from('payment_applications').insert({
        payment_id: paymentId,
        invoice_id: invoiceId,
        applied_amount: 500,
        applied_by: USER_ID,
      });
      expect(appErr).toBeNull();

      const { data, error } = await supabase.client.rpc('create_payment_journal_entry', {
        p_payment_id: paymentId,
        p_created_by: USER_ID,
      });
      expect(error).toBeNull();
      expect(data.entry_type).toBe(JournalEntryType.CustomerPayment);

      const lines = await journalLines(data.journal_entry_id);
      expect(lines).toHaveLength(2);
      expect(lines[0].account_id).toBe(account1020);
      expect(Number(lines[0].debit)).toBe(500);
      expect(lines[1].account_id).toBe(account1100);
      expect(Number(lines[1].credit)).toBe(500);
    });

    it('§4.3 advance_receipt Dr bank / Cr 2060 when no applications (D-1)', async () => {
      const paymentId = await insertPayment({ amount: 250, method: 'cash' });

      const { data, error } = await supabase.client.rpc('create_payment_journal_entry', {
        p_payment_id: paymentId,
        p_created_by: USER_ID,
      });
      expect(error).toBeNull();
      expect(data.entry_type).toBe(JournalEntryType.AdvanceReceipt);

      const lines = await journalLines(data.journal_entry_id);
      expect(lines[0].account_id).toBe(account1010);
      expect(Number(lines[0].debit)).toBe(250);
      expect(lines[1].account_id).toBe(account2060);
      expect(Number(lines[1].credit)).toBe(250);
    });

    it('§4.3 advance_application reclass Dr 2060 / Cr 1100 for applied_amount', async () => {
      const invoiceId = await createIssuedInvoice();
      const paymentId = await insertPayment({ amount: 400, method: 'cheque' });

      const { data: receipt, error: receiptErr } = await supabase.client.rpc(
        'create_payment_journal_entry',
        { p_payment_id: paymentId, p_created_by: USER_ID },
      );
      expect(receiptErr).toBeNull();
      expect(receipt.entry_type).toBe(JournalEntryType.AdvanceReceipt);

      const { data: app, error: appErr } = await supabase.client
        .from('payment_applications')
        .insert({
          payment_id: paymentId,
          invoice_id: invoiceId,
          applied_amount: 150,
          applied_by: USER_ID,
        })
        .select('id')
        .single();
      expect(appErr).toBeNull();

      const { data, error } = await supabase.client.rpc(
        'create_advance_application_journal_entry',
        {
          p_payment_application_id: app!.id,
          p_created_by: USER_ID,
        },
      );
      expect(error).toBeNull();

      const { data: entry } = await supabase.client
        .from('journal_entries')
        .select('entry_type')
        .eq('id', data.journal_entry_id)
        .single();
      expect(entry!.entry_type).toBe(JournalEntryType.AdvanceApplication);

      const lines = await journalLines(data.journal_entry_id);
      expect(lines[0].account_id).toBe(account2060);
      expect(Number(lines[0].debit)).toBe(150);
      expect(lines[1].account_id).toBe(account1100);
      expect(Number(lines[1].credit)).toBe(150);
    });

    it('D-12 routes card/pos to 1070 and honours bank_account_id override', async () => {
      const cardPaymentId = await insertPayment({ amount: 80, method: 'card' });
      const { data: cardPost, error: cardErr } = await supabase.client.rpc(
        'create_payment_journal_entry',
        { p_payment_id: cardPaymentId, p_created_by: USER_ID },
      );
      expect(cardErr).toBeNull();
      const cardLines = await journalLines(cardPost.journal_entry_id);
      expect(cardLines[0].account_id).toBe(account1070);

      const overridePaymentId = await insertPayment({
        amount: 90,
        method: 'cash',
        bankAccountId: account1020,
      });
      const { data: overridePost, error: overrideErr } = await supabase.client.rpc(
        'create_payment_journal_entry',
        { p_payment_id: overridePaymentId, p_created_by: USER_ID },
      );
      expect(overrideErr).toBeNull();
      const overrideLines = await journalLines(overridePost.journal_entry_id);
      expect(overrideLines[0].account_id).toBe(account1020);
    });
  },
);
