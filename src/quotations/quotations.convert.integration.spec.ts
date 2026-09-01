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
import { InvoiceStatus } from '../invoices/common/enums/invoice-status.enum';
import { InvoicesModule } from '../invoices/invoices.module';
import { InvoicesService } from '../invoices/invoices.service';
import { QuotationStatus } from './common/enums/quotation-status.enum';
import { QuotationsModule } from './quotations.module';
import { QuotationsService } from './quotations.service';
import {
  INTEGRATION_USER_ID,
  mintFreshIntegrationCompany,
} from '../test/integration-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const USER_ID = INTEGRATION_USER_ID;
const QUOTATION_DATE = '2026-04-01';

(hasSupabase ? describe : describe.skip)(
  'Quotation convert to invoice (feature-spec-1.1.C.md §4 decision #9)',
  () => {
    jest.setTimeout(180_000);

    let quotationsService: QuotationsService;
    let invoicesService: InvoicesService;
    let customersService: CustomersService;
    let supabase: SupabaseService;
    let companyId = '';
    let customerId = '';
    const createdQuotationIds: string[] = [];
    const createdInvoiceIds: string[] = [];

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, CustomersModule, QuotationsModule, InvoicesModule],
      }).compile();

      quotationsService = module.get(QuotationsService);
      invoicesService = module.get(InvoicesService);
      customersService = module.get(CustomersService);
      supabase = module.get(SupabaseService);

      companyId = await mintFreshIntegrationCompany(supabase, 'Quotation convert C1-5');
      const customer = await customersService.create({
        company_id: companyId,
        customer_name: 'Convert test customer',
        trn: `1${Date.now()}`.slice(0, 15),
      });
      customerId = customer.id;
    }, 120_000);

    afterAll(async () => {
      for (const invoiceId of createdInvoiceIds.reverse()) {
        await supabase.client.from('invoice_lines').delete().eq('invoice_id', invoiceId);
        await supabase.client.from('invoices').delete().eq('id', invoiceId);
      }
      for (const quotationId of createdQuotationIds.reverse()) {
        await supabase.client.from('quotation_lines').delete().eq('quotation_id', quotationId);
        await supabase.client.from('quotations').delete().eq('id', quotationId);
      }
      await supabase.client.from('customers').delete().eq('id', customerId);
    });

    async function createDraftQuotation(
      lines: Parameters<QuotationsService['create']>[0]['lines'] = [
        {
          line_number: 1,
          description: 'Convert probe line',
          quantity: 2,
          unit_price: 100,
          vat_rate: 5,
        },
      ],
    ) {
      const created = await quotationsService.create(
        {
          company_id: companyId,
          customer_id: customerId,
          quotation_date: QUOTATION_DATE,
          valid_until: '2026-04-30',
          notes: 'Quotation notes — no invoice notes column in §1.3',
          lines,
        },
        USER_ID,
      );
      createdQuotationIds.push(created.quotation.id);
      return created;
    }

    async function acceptQuotation(quotationId: string) {
      await quotationsService.send(quotationId);
      await quotationsService.markViewed(quotationId);
      return quotationsService.accept(quotationId);
    }

    it('converts Accepted quotation to Draft invoice with copied lines and two-way link', async () => {
      const quotation = await createDraftQuotation([
        {
          line_number: 1,
          description: 'Widget A',
          quantity: 2,
          unit_price: 100,
          vat_rate: 5,
        },
        {
          line_number: 2,
          description: 'Zero-rated',
          quantity: 1,
          unit_price: 50,
          vat_rate: 0,
        },
      ]);
      await acceptQuotation(quotation.quotation.id);

      const invoice = await quotationsService.convert(quotation.quotation.id, USER_ID);
      createdInvoiceIds.push(invoice.invoice.id);

      expect(invoice.invoice.status).toBe(InvoiceStatus.Draft);
      expect(invoice.invoice.invoice_number).toBeNull();
      expect(invoice.invoice.invoice_type).toBeNull();
      expect(invoice.invoice.due_date).toBeNull();
      expect(invoice.invoice.source_quotation_id).toBe(quotation.quotation.id);
      expect(invoice.invoice.customer_id).toBe(customerId);
      expect(invoice.invoice.invoice_date).toBe(QUOTATION_DATE);
      expect(Number(invoice.invoice.subtotal)).toBe(Number(quotation.quotation.subtotal));
      expect(Number(invoice.invoice.vat_total)).toBe(Number(quotation.quotation.vat_total));
      expect(Number(invoice.invoice.grand_total)).toBe(Number(quotation.quotation.grand_total));

      expect(invoice.lines).toHaveLength(2);
      expect(invoice.lines[0].description).toBe('Widget A');
      expect(invoice.lines[1].description).toBe('Zero-rated');
      expect(Number(invoice.lines[0].line_total)).toBe(Number(quotation.lines[0].line_total));
      expect(Number(invoice.lines[1].line_total)).toBe(Number(quotation.lines[1].line_total));
      expect(invoice.lines[0].is_service).toBe(false);
      expect(invoice.lines[1].is_service).toBe(false);

      const refreshedQuotation = await quotationsService.findOne(quotation.quotation.id);
      expect(refreshedQuotation.quotation.converted_to_invoice_id).toBe(invoice.invoice.id);
      expect(refreshedQuotation.quotation.status).toBe(QuotationStatus.Accepted);
    });

    it.each([
      ['draft', async (id: string) => id],
      ['sent', async (id: string) => {
        await quotationsService.send(id);
        return id;
      }],
      ['declined', async (id: string) => {
        await quotationsService.send(id);
        await quotationsService.markViewed(id);
        await quotationsService.decline(id);
        return id;
      }],
      ['expired', async (id: string) => {
        const { error } = await supabase.client
          .from('quotations')
          .update({ status: QuotationStatus.Expired })
          .eq('id', id);
        expect(error).toBeNull();
        return id;
      }],
    ])('rejects convert when quotation status is %s', async (_label, prepare) => {
      const quotation = await createDraftQuotation();
      const quotationId = await prepare(quotation.quotation.id);

      await expect(quotationsService.convert(quotationId, USER_ID)).rejects.toThrow(
        BadRequestException,
      );
      await expect(quotationsService.convert(quotationId, USER_ID)).rejects.toThrow(
        /QUOTATION_NOT_ACCEPTED/,
      );

      const { count } = await supabase.client
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('source_quotation_id', quotationId);
      expect(count).toBe(0);
    });

    it('rejects second convert on already-converted quotation', async () => {
      const quotation = await createDraftQuotation();
      await acceptQuotation(quotation.quotation.id);

      const first = await quotationsService.convert(quotation.quotation.id, USER_ID);
      createdInvoiceIds.push(first.invoice.id);

      await expect(
        quotationsService.convert(quotation.quotation.id, USER_ID),
      ).rejects.toThrow(BadRequestException);
      await expect(
        quotationsService.convert(quotation.quotation.id, USER_ID),
      ).rejects.toThrow(/QUOTATION_ALREADY_CONVERTED/);

      const { count } = await supabase.client
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('source_quotation_id', quotation.quotation.id);
      expect(count).toBe(1);
    });

    it('carries quotation line is_service through to invoice lines unchanged', async () => {
      const quotation = await createDraftQuotation([
        {
          line_number: 1,
          description: 'Goods line',
          quantity: 1,
          unit_price: 100,
          vat_rate: 5,
          is_service: false,
        },
        {
          line_number: 2,
          description: 'Service line',
          quantity: 1,
          unit_price: 100,
          vat_rate: 5,
          is_service: true,
        },
      ]);
      expect(quotation.lines[0].is_service).toBe(false);
      expect(quotation.lines[1].is_service).toBe(true);

      await acceptQuotation(quotation.quotation.id);

      const invoice = await quotationsService.convert(quotation.quotation.id, USER_ID);
      createdInvoiceIds.push(invoice.invoice.id);

      expect(invoice.lines[0].is_service).toBe(false);
      expect(invoice.lines[1].is_service).toBe(true);
    });

    it('income_account_id per converted line matches C1-3 auto-suggestion for same vat_rate', async () => {
      const quotation = await createDraftQuotation([
        {
          line_number: 1,
          description: 'Standard goods',
          quantity: 1,
          unit_price: 10,
          vat_rate: 5,
          is_service: false,
        },
        {
          line_number: 2,
          description: 'Standard service',
          quantity: 1,
          unit_price: 10,
          vat_rate: 5,
          is_service: true,
        },
        {
          line_number: 3,
          description: 'Zero-rated',
          quantity: 1,
          unit_price: 10,
          vat_rate: 0,
          is_service: false,
        },
        {
          line_number: 4,
          description: 'Exempt',
          quantity: 1,
          unit_price: 10,
          vat_rate: 100,
          is_service: false,
        },
      ]);
      await acceptQuotation(quotation.quotation.id);

      const converted = await quotationsService.convert(quotation.quotation.id, USER_ID);
      createdInvoiceIds.push(converted.invoice.id);

      const baseline = await invoicesService.create(
        {
          company_id: companyId,
          customer_id: customerId,
          invoice_date: QUOTATION_DATE,
          lines: [
            {
              line_number: 1,
              description: 'Baseline goods',
              quantity: 1,
              unit_price: 10,
              vat_rate: 5,
              is_service: false,
            },
            {
              line_number: 2,
              description: 'Baseline service',
              quantity: 1,
              unit_price: 10,
              vat_rate: 5,
              is_service: true,
            },
            {
              line_number: 3,
              description: 'Baseline zero',
              quantity: 1,
              unit_price: 10,
              vat_rate: 0,
              is_service: false,
            },
            {
              line_number: 4,
              description: 'Baseline exempt',
              quantity: 1,
              unit_price: 10,
              vat_rate: 100,
              is_service: false,
            },
          ],
        },
        USER_ID,
      );
      createdInvoiceIds.push(baseline.invoice.id);

      const acct4000 = await getAccountIdByNumber(supabase, companyId, '4000');
      const acct4040 = await getAccountIdByNumber(supabase, companyId, '4040');
      const acct4010 = await getAccountIdByNumber(supabase, companyId, '4010');
      const acct4020 = await getAccountIdByNumber(supabase, companyId, '4020');

      expect(converted.lines[0].income_account_id).toBe(baseline.lines[0].income_account_id);
      expect(converted.lines[0].income_account_id).toBe(acct4000);
      expect(converted.lines[1].income_account_id).toBe(baseline.lines[1].income_account_id);
      expect(converted.lines[1].income_account_id).toBe(acct4040);
      expect(converted.lines[2].income_account_id).toBe(baseline.lines[2].income_account_id);
      expect(converted.lines[2].income_account_id).toBe(acct4010);
      expect(converted.lines[3].income_account_id).toBe(baseline.lines[3].income_account_id);
      expect(converted.lines[3].income_account_id).toBe(acct4020);
    });
  },
);
