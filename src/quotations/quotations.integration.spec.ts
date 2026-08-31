import { config } from 'dotenv';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

config({ path: resolve(__dirname, '../../.env.local') });

import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CustomersModule } from '../customers/customers.module';
import { CustomersService } from '../customers/customers.service';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
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
const CONCURRENCY = 8;

(hasSupabase ? describe : describe.skip)(
  'Quotations (feature-spec-1.1.C.md §1.2)',
  () => {
    jest.setTimeout(180_000);

    let quotationsService: QuotationsService;
    let customersService: CustomersService;
    let supabase: SupabaseService;
    let companyId = '';
    let customerId = '';
    const createdQuotationIds: string[] = [];

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, CustomersModule, QuotationsModule],
      }).compile();

      quotationsService = module.get(QuotationsService);
      customersService = module.get(CustomersService);
      supabase = module.get(SupabaseService);

      companyId = await mintFreshIntegrationCompany(supabase, 'Quotations C1-2');
      const customer = await customersService.create({
        company_id: companyId,
        customer_name: 'Quotation test customer',
        trn: `1${Date.now()}`.slice(0, 15),
      });
      customerId = customer.id;
    }, 120000);

    afterAll(async () => {
      for (const id of createdQuotationIds.reverse()) {
        await supabase.client.from('quotation_lines').delete().eq('quotation_id', id);
        await supabase.client.from('quotations').delete().eq('id', id);
      }
      await supabase.client.from('customers').delete().eq('id', customerId);
    });

    async function createDraftQuotation(lines?: Parameters<QuotationsService['create']>[0]['lines']) {
      const created = await quotationsService.create(
        {
          company_id: companyId,
          customer_id: customerId,
          quotation_date: '2026-03-01',
          valid_until: '2026-03-31',
          notes: 'Probe',
          lines,
        },
        USER_ID,
      );
      createdQuotationIds.push(created.quotation.id);
      return created;
    }

    it('computes totals on create and refreshes when lines change', async () => {
      const created = await createDraftQuotation([
        {
          line_number: 1,
          description: 'Widget',
          quantity: 10,
          unit_price: 100,
          vat_rate: 5,
        },
        {
          line_number: 2,
          description: 'Service',
          quantity: 2,
          unit_price: 50,
          discount_amount: 10,
          vat_rate: 0,
        },
      ]);

      expect(Number(created.quotation.subtotal)).toBe(1090);
      expect(Number(created.quotation.vat_total)).toBe(50);
      expect(Number(created.quotation.grand_total)).toBe(1140);
      expect(created.quotation.quotation_number).toMatch(/^QUO-2026-\d{4}$/);

      const lineId = created.lines[0].id;
      await quotationsService.updateLine(lineId, { quantity: 5 });

      const refreshed = await quotationsService.findOne(created.quotation.id);
      expect(Number(refreshed.quotation.subtotal)).toBe(590);
      expect(Number(refreshed.quotation.vat_total)).toBe(25);
      expect(Number(refreshed.quotation.grand_total)).toBe(615);
    });

    it('rejects line edits after status leaves draft', async () => {
      const created = await createDraftQuotation([
        {
          line_number: 1,
          description: 'Locked line probe',
          quantity: 1,
          unit_price: 100,
          vat_rate: 5,
        },
      ]);

      await quotationsService.send(created.quotation.id);
      await quotationsService.markViewed(created.quotation.id);

      await expect(
        quotationsService.updateLine(created.lines[0].id, { quantity: 2 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects direct client UPDATE of computed totals', async () => {
      const created = await createDraftQuotation([
        {
          line_number: 1,
          description: 'Totals lock probe',
          quantity: 1,
          unit_price: 10,
          vat_rate: 5,
        },
      ]);

      const { error } = await supabase.client
        .from('quotations')
        .update({ subtotal: 999, grand_total: 999 })
        .eq('id', created.quotation.id);

      expect(error?.message).toMatch(/QUOTATION_TOTALS_CLIENT_MUTATION_BLOCKED/);
    });

    it('rejects discount_percent and discount_amount both set', async () => {
      const created = await createDraftQuotation();

      const { error } = await supabase.client.from('quotation_lines').insert({
        quotation_id: created.quotation.id,
        line_number: 1,
        description: 'Bad discount',
        quantity: 1,
        unit_price: 100,
        discount_percent: 10,
        discount_amount: 5,
        vat_rate: 5,
      });

      expect(error?.code).toBe('23514');
    });

    it('allocates quotation_number on creation and keeps numbers unique per company', async () => {
      const a = await createDraftQuotation();
      const b = await createDraftQuotation();

      expect(a.quotation.quotation_number).toMatch(/^QUO-2026-/);
      expect(b.quotation.quotation_number).toMatch(/^QUO-2026-/);
      expect(a.quotation.quotation_number).not.toBe(b.quotation.quotation_number);
    });

    it('N concurrent quotation creates get unique quotation_numbers', async () => {
      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          quotationsService.create(
            {
              company_id: companyId,
              customer_id: customerId,
              quotation_date: '2026-03-15',
            },
            USER_ID,
          ),
        ),
      );

      for (const result of results) {
        createdQuotationIds.push(result.quotation.id);
      }

      const numbers = results.map((r) => r.quotation.quotation_number);
      expect(new Set(numbers).size).toBe(CONCURRENCY);
    });

    it('recalc trigger fires exactly once per line UPDATE (no header→line cascade)', async () => {
      const created = await createDraftQuotation([
        {
          line_number: 1,
          description: 'Recalc depth probe',
          quantity: 1,
          unit_price: 100,
          vat_rate: 5,
        },
      ]);

      const { data, error } = await supabase.client.rpc(
        'integration_verify_quotation_recalc_fires_once',
        {
          p_line_id: created.lines[0].id,
          p_quantity: 2,
        },
      );

      expect(error).toBeNull();
      expect(data).toEqual({ line_trigger_fires: 1, recalc_calls: 1 });
    });

    it('status transitions follow Draft → Sent → Viewed → Accepted', async () => {
      const created = await createDraftQuotation([
        {
          line_number: 1,
          description: 'Lifecycle probe',
          quantity: 1,
          unit_price: 50,
          vat_rate: 5,
        },
      ]);

      let current = await quotationsService.send(created.quotation.id);
      expect(current.quotation.status).toBe(QuotationStatus.Sent);

      current = await quotationsService.markViewed(created.quotation.id);
      expect(current.quotation.status).toBe(QuotationStatus.Viewed);

      current = await quotationsService.accept(created.quotation.id);
      expect(current.quotation.status).toBe(QuotationStatus.Accepted);
    });
  },
);
