import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { Test, TestingModule } from '@nestjs/testing';
import { CustomersModule } from '../customers/customers.module';
import { CustomersService } from '../customers/customers.service';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import {
  INTEGRATION_USER_ID,
  mintFreshIntegrationCompany,
} from '../test/integration-company.setup';
import { InvoiceStatus } from './common/enums/invoice-status.enum';
import { PaymentTermsType } from './common/enums/payment-terms-type.enum';
import { InvoicesModule } from './invoices.module';
import { InvoicesService } from './invoices.service';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const USER_ID = INTEGRATION_USER_ID;
/** Within minted FY2026 open period; cod → due_date equals invoice_date (< today). */
const PAST_INVOICE_DATE = '2026-06-01';
/** Within FY2026 open period; net_60 → due_date after today. */
const FUTURE_DUE_INVOICE_DATE = '2026-08-01';

(hasSupabase ? describe : describe.skip)(
  'Invoices mark_overdue_invoices (feature-spec-1.1.C.md §2.2 / §8)',
  () => {
    jest.setTimeout(180_000);

    let invoicesService: InvoicesService;
    let customersService: CustomersService;
    let supabase: SupabaseService;
    let companyId = '';
    let customerId = '';
    const createdInvoiceIds: string[] = [];

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, CustomersModule, InvoicesModule],
      }).compile();

      invoicesService = module.get(InvoicesService);
      customersService = module.get(CustomersService);
      supabase = module.get(SupabaseService);

      companyId = await mintFreshIntegrationCompany(supabase, 'Invoices overdue');
      const customer = await customersService.create({
        company_id: companyId,
        customer_name: 'Overdue test customer',
        trn: `1${Date.now()}`.slice(0, 15),
      });
      customerId = customer.id;
    }, 120000);

    afterAll(async () => {
      for (const id of createdInvoiceIds.reverse()) {
        const { data: inv } = await supabase.client
          .from('invoices')
          .select('journal_entry_id')
          .eq('id', id)
          .maybeSingle();
        await supabase.client.from('invoice_lines').delete().eq('invoice_id', id);
        await supabase.client.from('invoices').delete().eq('id', id);
        const journalEntryId = inv?.journal_entry_id as string | null | undefined;
        if (journalEntryId) {
          const { data: originalJe } = await supabase.client
            .from('journal_entries')
            .select('reversed_by_entry_id')
            .eq('id', journalEntryId)
            .maybeSingle();
          const reversalId = originalJe?.reversed_by_entry_id as string | null | undefined;
          if (reversalId) {
            await supabase.client.from('journal_lines').delete().eq('journal_entry_id', reversalId);
            await supabase.client.from('journal_entries').delete().eq('id', reversalId);
          }
          await supabase.client.from('journal_lines').delete().eq('journal_entry_id', journalEntryId);
          await supabase.client.from('journal_entries').delete().eq('id', journalEntryId);
        }
      }
      await supabase.client.from('customers').delete().eq('id', customerId);
    });

    async function createProbeInvoice(
      label: string,
      opts?: { invoiceDate?: string; paymentTerms?: PaymentTermsType },
    ) {
      const created = await invoicesService.create(
        {
          company_id: companyId,
          customer_id: customerId,
          invoice_date: opts?.invoiceDate ?? PAST_INVOICE_DATE,
          payment_terms: opts?.paymentTerms ?? PaymentTermsType.Cod,
          lines: [
            {
              line_number: 1,
              description: label,
              quantity: 1,
              unit_price: 100,
              vat_rate: 5,
            },
          ],
        },
        USER_ID,
      );
      createdInvoiceIds.push(created.invoice.id);
      return created;
    }

    async function issuePastDue(label: string) {
      const created = await createProbeInvoice(label);
      await invoicesService.issue(created.invoice.id);
      return created;
    }

    async function setInvoiceStatus(invoiceId: string, status: InvoiceStatus) {
      const { error } = await supabase.client
        .from('invoices')
        .update({ status })
        .eq('id', invoiceId);
      if (error) {
        throw error;
      }
    }

    it('marks only issued/sent/viewed with past due_date overdue; idempotent on re-run', async () => {
      expect(InvoiceStatus.PartiallyPaid).toBe('partially_paid');

      const issuedPast = await issuePastDue('issued past');
      const sentPast = await issuePastDue('sent past');
      await invoicesService.send(sentPast.invoice.id);

      const viewedPast = await issuePastDue('viewed past');
      await invoicesService.send(viewedPast.invoice.id);
      await invoicesService.markViewed(viewedPast.invoice.id);

      const partiallyPaidPast = await issuePastDue('partially paid past');
      await setInvoiceStatus(
        partiallyPaidPast.invoice.id,
        InvoiceStatus.PartiallyPaid,
      );

      const paidPast = await issuePastDue('paid past');
      await setInvoiceStatus(paidPast.invoice.id, InvoiceStatus.Paid);

      const voidPast = await issuePastDue('void past');
      await invoicesService.void(voidPast.invoice.id, { void_reason: 'test void' }, USER_ID);

      const writtenOffPast = await issuePastDue('written off past');
      await invoicesService.writeOff(
        writtenOffPast.invoice.id,
        { reason: 'integration overdue probe write-off' },
        USER_ID,
      );

      const alreadyOverdue = await issuePastDue('already overdue');
      await setInvoiceStatus(alreadyOverdue.invoice.id, InvoiceStatus.Overdue);

      const issuedFuture = await createProbeInvoice('issued future', {
        invoiceDate: FUTURE_DUE_INVOICE_DATE,
        paymentTerms: PaymentTermsType.Net60,
      });
      await invoicesService.issue(issuedFuture.invoice.id);

      const draftPast = await createProbeInvoice('draft past');

      const { data: amountPaidBefore } = await supabase.client
        .from('invoices')
        .select('amount_paid')
        .eq('id', issuedPast.invoice.id)
        .single();

      const { data: firstCount, error: firstError } = await supabase.client.rpc(
        'mark_overdue_invoices',
        { p_company_id: companyId },
      );
      expect(firstError).toBeNull();
      expect(firstCount).toBe(3);

      const expectOverdue = [
        issuedPast.invoice.id,
        sentPast.invoice.id,
        viewedPast.invoice.id,
      ];
      const expectStillOverdue = [alreadyOverdue.invoice.id];
      const expectUnchanged = [
        partiallyPaidPast.invoice.id,
        paidPast.invoice.id,
        voidPast.invoice.id,
        writtenOffPast.invoice.id,
        issuedFuture.invoice.id,
        draftPast.invoice.id,
      ];

      for (const id of expectOverdue) {
        const { data } = await supabase.client
          .from('invoices')
          .select('status')
          .eq('id', id)
          .single();
        expect(data?.status).toBe(InvoiceStatus.Overdue);
      }

      for (const id of expectStillOverdue) {
        const { data } = await supabase.client
          .from('invoices')
          .select('status')
          .eq('id', id)
          .single();
        expect(data?.status).toBe(InvoiceStatus.Overdue);
      }

      for (const id of expectUnchanged) {
        const { data } = await supabase.client
          .from('invoices')
          .select('status')
          .eq('id', id)
          .single();
        expect(data?.status).not.toBe(InvoiceStatus.Overdue);
      }

      expect(
        (
          await supabase.client
            .from('invoices')
            .select('status')
            .eq('id', partiallyPaidPast.invoice.id)
            .single()
        ).data?.status,
      ).toBe(InvoiceStatus.PartiallyPaid);

      expect(
        (
          await supabase.client
            .from('invoices')
            .select('status')
            .eq('id', paidPast.invoice.id)
            .single()
        ).data?.status,
      ).toBe(InvoiceStatus.Paid);

      expect(
        (
          await supabase.client
            .from('invoices')
            .select('status')
            .eq('id', voidPast.invoice.id)
            .single()
        ).data?.status,
      ).toBe(InvoiceStatus.Void);

      expect(
        (
          await supabase.client
            .from('invoices')
            .select('status')
            .eq('id', writtenOffPast.invoice.id)
            .single()
        ).data?.status,
      ).toBe(InvoiceStatus.WrittenOff);

      expect(
        (
          await supabase.client
            .from('invoices')
            .select('status')
            .eq('id', issuedFuture.invoice.id)
            .single()
        ).data?.status,
      ).toBe(InvoiceStatus.Issued);

      expect(
        (
          await supabase.client
            .from('invoices')
            .select('status')
            .eq('id', draftPast.invoice.id)
            .single()
        ).data?.status,
      ).toBe(InvoiceStatus.Draft);

      const { data: amountPaidAfter } = await supabase.client
        .from('invoices')
        .select('amount_paid')
        .eq('id', issuedPast.invoice.id)
        .single();
      expect(amountPaidAfter?.amount_paid).toBe(amountPaidBefore?.amount_paid);

      const { data: secondCount, error: secondError } = await supabase.client.rpc(
        'mark_overdue_invoices',
        { p_company_id: companyId },
      );
      expect(secondError).toBeNull();
      expect(secondCount).toBe(0);
    });
  },
);
