import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CustomersModule } from '../customers/customers.module';
import { CustomersService } from '../customers/customers.service';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import { getAccountIdByNumber } from '../e2e/e2e-company.setup';
import { InvoiceStatus } from './common/enums/invoice-status.enum';
import { InvoiceType } from './common/enums/invoice-type.enum';
import { PaymentTermsType } from './common/enums/payment-terms-type.enum';
import { InvoicesModule } from './invoices.module';
import { InvoicesService } from './invoices.service';
import {
  INTEGRATION_USER_ID,
  mintFreshIntegrationCompany,
} from '../test/integration-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const USER_ID = INTEGRATION_USER_ID;
const INVOICE_DATE = '2026-06-01';

(hasSupabase ? describe : describe.skip)(
  'Invoices (feature-spec-1.1.C.md §1.3 C1-3)',
  () => {
    jest.setTimeout(180_000);

    let invoicesService: InvoicesService;
    let customersService: CustomersService;
    let supabase: SupabaseService;
    let companyId = '';
    let customerWithTrnId = '';
    let customerNoTrnId = '';
    const createdInvoiceIds: string[] = [];
    const createdCustomerIds: string[] = [];

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, CustomersModule, InvoicesModule],
      }).compile();

      invoicesService = module.get(InvoicesService);
      customersService = module.get(CustomersService);
      supabase = module.get(SupabaseService);

      companyId = await mintFreshIntegrationCompany(supabase, 'Invoices C1-3');

      const withTrn = await customersService.create({
        company_id: companyId,
        customer_name: 'Invoice TRN customer',
        trn: `1${Date.now()}`.slice(0, 15),
      });
      customerWithTrnId = withTrn.id;
      createdCustomerIds.push(withTrn.id);

      const noTrn = await customersService.create({
        company_id: companyId,
        customer_name: 'Invoice no-TRN customer',
      });
      customerNoTrnId = noTrn.id;
      createdCustomerIds.push(noTrn.id);
    }, 120000);

    afterAll(async () => {
      for (const id of createdInvoiceIds.reverse()) {
        await supabase.client.from('invoice_lines').delete().eq('invoice_id', id);
        await supabase.client.from('invoices').delete().eq('id', id);
      }
      for (const id of createdCustomerIds.reverse()) {
        await supabase.client.from('customers').delete().eq('id', id);
      }
    });

    async function createDraftInvoice(
      customerId: string,
      opts?: {
        payment_terms?: PaymentTermsType;
        custom_days?: number;
        unit_price?: number;
        vat_rate?: number;
      },
    ) {
      const created = await invoicesService.create(
        {
          company_id: companyId,
          customer_id: customerId,
          invoice_date: INVOICE_DATE,
          payment_terms: opts?.payment_terms ?? PaymentTermsType.Net30,
          custom_days: opts?.custom_days,
          lines: [
            {
              line_number: 1,
              description: 'Standalone invoice line',
              quantity: 1,
              unit_price: opts?.unit_price ?? 100,
              vat_rate: opts?.vat_rate ?? 5,
            },
          ],
        },
        USER_ID,
      );
      createdInvoiceIds.push(created.invoice.id);
      return created;
    }

    it('creates draft with null invoice_number and computes totals', async () => {
      const created = await createDraftInvoice(customerWithTrnId, { unit_price: 1000, vat_rate: 5 });

      expect(created.invoice.invoice_number).toBeNull();
      expect(created.invoice.invoice_type).toBeNull();
      expect(created.invoice.due_date).toBeNull();
      expect(Number(created.invoice.subtotal)).toBe(1000);
      expect(Number(created.invoice.vat_total)).toBe(50);
      expect(Number(created.invoice.grand_total)).toBe(1050);
      expect(created.invoice.journal_entry_id).toBeNull();
    });

    it('locks totals and lines after issue', async () => {
      const created = await createDraftInvoice(customerWithTrnId);
      const issued = await invoicesService.issue(created.invoice.id);

      expect(issued.ledger_posting_status).toBe('deferred_batch_2');
      expect(issued.journal_entry_id).toBeNull();
      expect(issued.invoice.journal_entry_id).toBeNull();
      expect(issued.invoice.invoice_number).toMatch(/^INV-2026-\d{4}$/);

      await expect(
        invoicesService.updateLine(created.lines[0].id, { quantity: 2 }),
      ).rejects.toThrow(BadRequestException);

      const { error } = await supabase.client
        .from('invoices')
        .update({ subtotal: 999 })
        .eq('id', created.invoice.id);

      expect(error?.message).toMatch(/INVOICE_TOTALS_CLIENT_MUTATION_BLOCKED/);
    });

    it('invoice_type: no TRN + under threshold → simplified', async () => {
      const draft = await createDraftInvoice(customerNoTrnId, { unit_price: 9500, vat_rate: 5 });
      expect(Number(draft.invoice.grand_total)).toBeLessThanOrEqual(10000);

      const issued = await invoicesService.issue(draft.invoice.id);
      expect(issued.invoice.invoice_type).toBe(InvoiceType.SimplifiedTaxInvoice);
    });

    it('invoice_type: no TRN + over threshold → still simplified (branch 1)', async () => {
      const draft = await createDraftInvoice(customerNoTrnId, { unit_price: 20000, vat_rate: 5 });

      const issued = await invoicesService.issue(draft.invoice.id);
      expect(issued.invoice.invoice_type).toBe(InvoiceType.SimplifiedTaxInvoice);
    });

    it('invoice_type: TRN + under threshold → simplified (branch 2)', async () => {
      const draft = await createDraftInvoice(customerWithTrnId, { unit_price: 9500, vat_rate: 5 });
      expect(Number(draft.invoice.grand_total)).toBe(9975);

      const issued = await invoicesService.issue(draft.invoice.id);
      expect(issued.invoice.invoice_type).toBe(InvoiceType.SimplifiedTaxInvoice);
    });

    it('invoice_type: TRN + over threshold → tax_invoice (branch 2)', async () => {
      const draft = await createDraftInvoice(customerWithTrnId, { unit_price: 9600, vat_rate: 5 });
      expect(Number(draft.invoice.grand_total)).toBeGreaterThan(10000);

      const issued = await invoicesService.issue(draft.invoice.id);
      expect(issued.invoice.invoice_type).toBe(InvoiceType.TaxInvoice);
    });

    it('allows tax_invoice override when simplified would be permitted', async () => {
      const draft = await createDraftInvoice(customerWithTrnId, { unit_price: 100, vat_rate: 5 });

      const issued = await invoicesService.issue(draft.invoice.id, {
        invoice_type_override: InvoiceType.TaxInvoice,
      });
      expect(issued.invoice.invoice_type).toBe(InvoiceType.TaxInvoice);
    });

    it('rejects simplified override when tax_invoice is required', async () => {
      const draft = await createDraftInvoice(customerWithTrnId, { unit_price: 9600, vat_rate: 5 });

      const { error } = await supabase.client.rpc('issue_invoice', {
        p_invoice_id: draft.invoice.id,
        p_invoice_type_override: InvoiceType.SimplifiedTaxInvoice,
      });

      expect(error?.message).toMatch(/INVOICE_TYPE_OVERRIDE_NOT_PERMITTED/);
    });

    it.each([
      [PaymentTermsType.Net7, '2026-06-08'],
      [PaymentTermsType.Net15, '2026-06-16'],
      [PaymentTermsType.Net30, '2026-07-01'],
      [PaymentTermsType.Net60, '2026-07-31'],
      [PaymentTermsType.Cod, INVOICE_DATE],
    ])('due_date for %s', async (terms, expectedDue) => {
      const draft = await createDraftInvoice(customerWithTrnId, { payment_terms: terms });
      const issued = await invoicesService.issue(draft.invoice.id);
      expect(issued.invoice.due_date).toBe(expectedDue);
    });

    it('due_date for custom payment terms uses custom_days', async () => {
      const draft = await createDraftInvoice(customerWithTrnId, {
        payment_terms: PaymentTermsType.Custom,
        custom_days: 10,
      });
      const issued = await invoicesService.issue(draft.invoice.id);
      expect(issued.invoice.due_date).toBe('2026-06-11');
    });

    it('void requires void_reason', async () => {
      const draft = await createDraftInvoice(customerWithTrnId);
      await invoicesService.issue(draft.invoice.id);

      await expect(invoicesService.void(draft.invoice.id, { void_reason: '   ' })).rejects.toThrow(
        BadRequestException,
      );

      const voided = await invoicesService.void(draft.invoice.id, {
        void_reason: 'Customer cancelled before payment',
      });
      expect(voided.invoice.status).toBe(InvoiceStatus.Void);
      expect(voided.invoice.void_reason).toBe('Customer cancelled before payment');
      expect(voided.invoice.journal_entry_id).toBeNull();
    });

    it('suggests income_account_id from vat_rate and is_service', async () => {
      const goods = await invoicesService.create(
        {
          company_id: companyId,
          customer_id: customerWithTrnId,
          invoice_date: INVOICE_DATE,
          lines: [
            {
              line_number: 1,
              description: 'Goods',
              quantity: 1,
              unit_price: 10,
              vat_rate: 5,
              is_service: false,
            },
          ],
        },
        USER_ID,
      );
      createdInvoiceIds.push(goods.invoice.id);

      const service = await invoicesService.create(
        {
          company_id: companyId,
          customer_id: customerWithTrnId,
          invoice_date: INVOICE_DATE,
          lines: [
            {
              line_number: 1,
              description: 'Service',
              quantity: 1,
              unit_price: 10,
              vat_rate: 5,
              is_service: true,
            },
          ],
        },
        USER_ID,
      );
      createdInvoiceIds.push(service.invoice.id);

      const goods4000 = await getAccountIdByNumber(supabase, companyId, '4000');
      const service4040 = await getAccountIdByNumber(supabase, companyId, '4040');

      expect(goods.lines[0].income_account_id).toBe(goods4000);
      expect(service.lines[0].income_account_id).toBe(service4040);
    });

    it('concurrent Issue on two drafts yields unique invoice_numbers', async () => {
      const a = await createDraftInvoice(customerWithTrnId);
      const b = await createDraftInvoice(customerWithTrnId);

      const [issuedA, issuedB] = await Promise.all([
        invoicesService.issue(a.invoice.id),
        invoicesService.issue(b.invoice.id),
      ]);

      expect(issuedA.invoice.invoice_number).toMatch(/^INV-2026-/);
      expect(issuedB.invoice.invoice_number).toMatch(/^INV-2026-/);
      expect(issuedA.invoice.invoice_number).not.toBe(issuedB.invoice.invoice_number);
    });
  },
);
