import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { Test, TestingModule } from '@nestjs/testing';
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

/**
 * [feature-spec-1_1_D.md §4.1 / D-3 / §4.3]
 * amount_paid / partially_paid / paid / paid_at from payment_applications only.
 */
(hasSupabase ? describe : describe.skip)(
  'Invoice amount_paid from applications (feature-spec-1_1_D.md §4.1)',
  () => {
    jest.setTimeout(180_000);

    let invoicesService: InvoicesService;
    let customersService: CustomersService;
    let supabase: SupabaseService;
    let companyId = '';
    let customerId = '';
    let incomeAccountId = '';
    const paymentIds: string[] = [];
    const invoiceIds: string[] = [];

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, CustomersModule, InvoicesModule],
      }).compile();

      invoicesService = module.get(InvoicesService);
      customersService = module.get(CustomersService);
      supabase = module.get(SupabaseService);

      companyId = await mintFreshIntegrationCompany(supabase, 'Inv amount_paid');
      const customer = await customersService.create({
        company_id: companyId,
        customer_name: 'Inv amount_paid customer',
      });
      customerId = customer.id;
      incomeAccountId = await getAccountIdByNumber(supabase, companyId, '4000');
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

    /** Issued invoice: 1000 + 5% VAT = 1050 grand_total. */
    async function createIssuedInvoice(): Promise<{ id: string; grandTotal: number }> {
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
      return {
        id: issued.invoice.id,
        grandTotal: Number(issued.invoice.grand_total),
      };
    }

    async function insertPayment(amount: number): Promise<string> {
      const { data, error } = await supabase.client
        .from('payments')
        .insert({
          company_id: companyId,
          customer_id: customerId,
          payment_date: '2026-06-15',
          amount,
          payment_method: 'bank_transfer',
          unapplied_amount: amount,
          created_by: USER_ID,
        })
        .select('id')
        .single();
      expect(error).toBeNull();
      paymentIds.push(data!.id);
      return data!.id;
    }

    async function loadInvoice(id: string) {
      const { data, error } = await supabase.client
        .from('invoices')
        .select('amount_paid, status, paid_at, grand_total')
        .eq('id', id)
        .single();
      expect(error).toBeNull();
      return data!;
    }

    it('partial application → partially_paid; amount_paid from applications only', async () => {
      const inv = await createIssuedInvoice();
      expect(inv.grandTotal).toBe(1050);

      const paymentId = await insertPayment(400);
      const { error } = await supabase.client.from('payment_applications').insert({
        payment_id: paymentId,
        invoice_id: inv.id,
        applied_amount: 400,
        applied_by: USER_ID,
      });
      expect(error).toBeNull();

      const row = await loadInvoice(inv.id);
      expect(Number(row.amount_paid)).toBe(400);
      expect(row.status).toBe(InvoiceStatus.PartiallyPaid);
      expect(row.paid_at).toBeNull();
    });

    it('full application → paid and stamps paid_at once (D-3)', async () => {
      const inv = await createIssuedInvoice();
      const paymentId = await insertPayment(1050);

      const { error } = await supabase.client.from('payment_applications').insert({
        payment_id: paymentId,
        invoice_id: inv.id,
        applied_amount: 1050,
        applied_by: USER_ID,
      });
      expect(error).toBeNull();

      const row = await loadInvoice(inv.id);
      expect(Number(row.amount_paid)).toBe(1050);
      expect(row.status).toBe(InvoiceStatus.Paid);
      expect(row.paid_at).toBeTruthy();
      const firstPaidAt = row.paid_at;

      // Re-touch via zero-sum path: delete then re-apply full → paid_at unchanged.
      await supabase.client.from('payment_applications').delete().eq('payment_id', paymentId);
      const mid = await loadInvoice(inv.id);
      expect(Number(mid.amount_paid)).toBe(0);
      expect(mid.paid_at).toBe(firstPaidAt); // D-3: never cleared

      const { error: reErr } = await supabase.client.from('payment_applications').insert({
        payment_id: paymentId,
        invoice_id: inv.id,
        applied_amount: 1050,
        applied_by: USER_ID,
      });
      expect(reErr).toBeNull();
      const again = await loadInvoice(inv.id);
      expect(again.status).toBe(InvoiceStatus.Paid);
      expect(again.paid_at).toBe(firstPaidAt);
    });

    it('rejects application that would push amount_paid past grand_total', async () => {
      const inv = await createIssuedInvoice();
      const paymentId = await insertPayment(2000);

      const { error: okErr } = await supabase.client.from('payment_applications').insert({
        payment_id: paymentId,
        invoice_id: inv.id,
        applied_amount: 1000,
        applied_by: USER_ID,
      });
      expect(okErr).toBeNull();

      const { error: overErr } = await supabase.client.from('payment_applications').insert({
        payment_id: paymentId,
        invoice_id: inv.id,
        applied_amount: 100,
        applied_by: USER_ID,
      });
      expect(overErr).toBeTruthy();
      expect(overErr!.message).toMatch(/INVOICE_PAYMENT_OVER_APPLIED/);

      const row = await loadInvoice(inv.id);
      expect(Number(row.amount_paid)).toBe(1000);
      expect(row.status).toBe(InvoiceStatus.PartiallyPaid);

      const { data: pay } = await supabase.client
        .from('payments')
        .select('unapplied_amount')
        .eq('id', paymentId)
        .single();
      // Excess remains unapplied on the payment (1000 of 2000 applied).
      expect(Number(pay!.unapplied_amount)).toBe(1000);
    });

    it('§4.3 advance receipt alone does not move amount_paid; application does', async () => {
      const inv = await createIssuedInvoice();
      const paymentId = await insertPayment(300);

      const { error: receiptErr } = await supabase.client.rpc('create_payment_journal_entry', {
        p_payment_id: paymentId,
        p_created_by: USER_ID,
      });
      expect(receiptErr).toBeNull();

      let row = await loadInvoice(inv.id);
      expect(Number(row.amount_paid)).toBe(0);
      expect(row.status).toBe(InvoiceStatus.Issued);

      const { data: app, error: appErr } = await supabase.client
        .from('payment_applications')
        .insert({
          payment_id: paymentId,
          invoice_id: inv.id,
          applied_amount: 300,
          applied_by: USER_ID,
        })
        .select('id')
        .single();
      expect(appErr).toBeNull();

      row = await loadInvoice(inv.id);
      expect(Number(row.amount_paid)).toBe(300);
      expect(row.status).toBe(InvoiceStatus.PartiallyPaid);

      // Reclass JE is the GL counterpart; amount_paid already moved on insert.
      const { error: reclassErr } = await supabase.client.rpc(
        'create_advance_application_journal_entry',
        { p_payment_application_id: app!.id, p_created_by: USER_ID },
      );
      expect(reclassErr).toBeNull();
      row = await loadInvoice(inv.id);
      expect(Number(row.amount_paid)).toBe(300);
    });

    it('blocks client UPDATE of amount_paid / paid_at', async () => {
      const inv = await createIssuedInvoice();

      const { error: amtErr } = await supabase.client
        .from('invoices')
        .update({ amount_paid: 50 })
        .eq('id', inv.id);
      expect(amtErr).toBeTruthy();
      expect(amtErr!.message).toMatch(/INVOICE_AMOUNT_PAID_CLIENT_MUTATION_BLOCKED/);

      const { error: paidAtErr } = await supabase.client
        .from('invoices')
        .update({ paid_at: new Date().toISOString() })
        .eq('id', inv.id);
      expect(paidAtErr).toBeTruthy();
      expect(paidAtErr!.message).toMatch(/INVOICE_AMOUNT_PAID_CLIENT_MUTATION_BLOCKED/);
    });
  },
);
