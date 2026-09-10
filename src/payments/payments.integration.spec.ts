import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { BadRequestException } from '@nestjs/common';
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
import { PaymentMethodType } from './common/enums/payment-method-type.enum';
import { PaymentsModule } from './payments.module';
import { PaymentsService } from './payments.service';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const USER_ID = INTEGRATION_USER_ID;

/**
 * [feature-spec-1_1_D.md §4.2 / §4.3 / D-1]
 */
(hasSupabase ? describe : describe.skip)(
  'Payments Nest module (feature-spec-1_1_D.md §4.2 / §4.3)',
  () => {
    jest.setTimeout(180_000);

    let paymentsService: PaymentsService;
    let invoicesService: InvoicesService;
    let customersService: CustomersService;
    let supabase: SupabaseService;
    let companyId = '';
    let customerId = '';
    let incomeAccountId = '';
    let account1100 = '';
    let account1020 = '';
    let account2060 = '';
    const paymentIds: string[] = [];
    const invoiceIds: string[] = [];

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, CustomersModule, InvoicesModule, PaymentsModule],
      }).compile();

      paymentsService = module.get(PaymentsService);
      invoicesService = module.get(InvoicesService);
      customersService = module.get(CustomersService);
      supabase = module.get(SupabaseService);

      companyId = await mintFreshIntegrationCompany(supabase, 'Payments Nest');
      const customer = await customersService.create({
        company_id: companyId,
        customer_name: 'Payments Nest customer',
      });
      customerId = customer.id;
      incomeAccountId = await getAccountIdByNumber(supabase, companyId, '4000');
      account1100 = await getAccountIdByNumber(supabase, companyId, '1100');
      account1020 = await getAccountIdByNumber(supabase, companyId, '1020');
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

    async function createIssuedInvoice(unitPrice = 1000): Promise<string> {
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
              unit_price: unitPrice,
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

    it('§4.2 creates payment with multi-invoice applications and posts customer_payment', async () => {
      const inv1 = await createIssuedInvoice(1000); // 1050
      const inv2 = await createIssuedInvoice(400); // 420

      const created = await paymentsService.create(
        {
          company_id: companyId,
          customer_id: customerId,
          payment_date: '2026-06-15',
          amount: 800,
          payment_method: PaymentMethodType.BankTransfer,
          applications: [
            { invoice_id: inv1, applied_amount: 500 },
            { invoice_id: inv2, applied_amount: 300 },
          ],
        },
        USER_ID,
      );
      paymentIds.push(created.payment.id);
      expect(created.applications).toHaveLength(2);
      expect(Number(created.payment.unapplied_amount)).toBe(0);

      const posted = await paymentsService.post(created.payment.id, USER_ID);
      expect(posted.payment.journal_entry_id).toBeTruthy();

      const { data: entry } = await supabase.client
        .from('journal_entries')
        .select('entry_type')
        .eq('id', posted.payment.journal_entry_id!)
        .single();
      expect(entry!.entry_type).toBe(JournalEntryType.CustomerPayment);

      const { data: lines } = await supabase.client
        .from('journal_lines')
        .select('account_id, debit, credit')
        .eq('journal_entry_id', posted.payment.journal_entry_id!)
        .order('line_number');
      expect(lines![0].account_id).toBe(account1020);
      expect(Number(lines![0].debit)).toBe(800);
      expect(lines![1].account_id).toBe(account1100);
      expect(Number(lines![1].credit)).toBe(800);

      const inv1Row = await invoicesService.findOne(inv1);
      expect(inv1Row.invoice.status).toBe(InvoiceStatus.PartiallyPaid);
      expect(Number(inv1Row.invoice.amount_paid)).toBe(500);
    });

    it('§4.3 advance receipt then application + reclass post', async () => {
      const invoiceId = await createIssuedInvoice(1000);

      const advance = await paymentsService.create(
        {
          company_id: companyId,
          customer_id: customerId,
          payment_date: '2026-06-10',
          amount: 250,
          payment_method: PaymentMethodType.Cash,
        },
        USER_ID,
      );
      paymentIds.push(advance.payment.id);
      expect(advance.applications).toHaveLength(0);
      expect(Number(advance.payment.unapplied_amount)).toBe(250);

      const receipt = await paymentsService.post(advance.payment.id, USER_ID);
      const { data: receiptEntry } = await supabase.client
        .from('journal_entries')
        .select('entry_type')
        .eq('id', receipt.payment.journal_entry_id!)
        .single();
      expect(receiptEntry!.entry_type).toBe(JournalEntryType.AdvanceReceipt);

      const { data: receiptLines } = await supabase.client
        .from('journal_lines')
        .select('account_id, debit, credit')
        .eq('journal_entry_id', receipt.payment.journal_entry_id!)
        .order('line_number');
      expect(receiptLines![1].account_id).toBe(account2060);

      const app = await paymentsService.createApplication(
        { payment_id: advance.payment.id, invoice_id: invoiceId, applied_amount: 150 },
        USER_ID,
      );
      const reclass = await paymentsService.postAdvanceApplication(app.id, USER_ID);
      expect(reclass.journal_entry_id).toBeTruthy();

      const after = await paymentsService.findOne(advance.payment.id);
      expect(Number(after.payment.unapplied_amount)).toBe(100);

      const inv = await invoicesService.findOne(invoiceId);
      expect(Number(inv.invoice.amount_paid)).toBe(150);
      expect(inv.invoice.status).toBe(InvoiceStatus.PartiallyPaid);
    });

    it('blocks header update/delete after journal post', async () => {
      const created = await paymentsService.create(
        {
          company_id: companyId,
          customer_id: customerId,
          payment_date: '2026-06-20',
          amount: 40,
          payment_method: PaymentMethodType.Card,
        },
        USER_ID,
      );
      paymentIds.push(created.payment.id);
      await paymentsService.post(created.payment.id, USER_ID);

      await expect(
        paymentsService.update(created.payment.id, { reference_number: 'x' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(paymentsService.remove(created.payment.id)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  },
);
