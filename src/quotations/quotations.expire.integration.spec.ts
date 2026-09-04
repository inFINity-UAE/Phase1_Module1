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
import { QuotationStatus } from './common/enums/quotation-status.enum';
import { QuotationsModule } from './quotations.module';
import { QuotationsService } from './quotations.service';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const USER_ID = INTEGRATION_USER_ID;
const PAST_VALID_UNTIL = '2020-01-01';
const FUTURE_VALID_UNTIL = '2099-12-31';

(hasSupabase ? describe : describe.skip)(
  'Quotations expire_due_quotations (feature-spec-1.1.C.md §2.1 / §8)',
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

      companyId = await mintFreshIntegrationCompany(supabase, 'Quotations expire');
      const customer = await customersService.create({
        company_id: companyId,
        customer_name: 'Expire test customer',
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

    async function createProbeQuotation(label: string) {
      const created = await quotationsService.create(
        {
          company_id: companyId,
          customer_id: customerId,
          quotation_date: '2026-03-01',
          valid_until: PAST_VALID_UNTIL,
          notes: label,
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
      createdQuotationIds.push(created.quotation.id);
      return created;
    }

    async function setValidUntil(quotationId: string, validUntil: string | null) {
      const { error } = await supabase.client
        .from('quotations')
        .update({ valid_until: validUntil })
        .eq('id', quotationId);
      if (error) {
        throw error;
      }
    }

    it('expires only draft/sent/viewed with past valid_until; idempotent on re-run', async () => {
      const draftPast = await createProbeQuotation('draft past');
      const sentPast = await createProbeQuotation('sent past');
      await quotationsService.send(sentPast.quotation.id);

      const viewedPast = await createProbeQuotation('viewed past');
      await quotationsService.send(viewedPast.quotation.id);
      await quotationsService.markViewed(viewedPast.quotation.id);

      const acceptedPast = await createProbeQuotation('accepted past');
      await quotationsService.send(acceptedPast.quotation.id);
      await quotationsService.markViewed(acceptedPast.quotation.id);
      await quotationsService.accept(acceptedPast.quotation.id);

      const declinedPast = await createProbeQuotation('declined past');
      await quotationsService.send(declinedPast.quotation.id);
      await quotationsService.markViewed(declinedPast.quotation.id);
      await quotationsService.decline(declinedPast.quotation.id);

      const alreadyExpired = await createProbeQuotation('already expired');
      const { error: expiredErr } = await supabase.client
        .from('quotations')
        .update({ status: QuotationStatus.Expired })
        .eq('id', alreadyExpired.quotation.id);
      expect(expiredErr).toBeNull();

      const draftFuture = await createProbeQuotation('draft future');
      await setValidUntil(draftFuture.quotation.id, FUTURE_VALID_UNTIL);

      const draftNullUntil = await createProbeQuotation('draft null until');
      await setValidUntil(draftNullUntil.quotation.id, null);

      const { data: firstCount, error: firstError } = await supabase.client.rpc(
        'expire_due_quotations',
        { p_company_id: companyId },
      );
      expect(firstError).toBeNull();
      expect(firstCount).toBe(3);

      const expectExpired = [
        draftPast.quotation.id,
        sentPast.quotation.id,
        viewedPast.quotation.id,
      ];
      const expectStillExpired = [alreadyExpired.quotation.id];
      const expectUnchanged = [
        acceptedPast.quotation.id,
        declinedPast.quotation.id,
        draftFuture.quotation.id,
        draftNullUntil.quotation.id,
      ];

      for (const id of expectExpired) {
        const { data } = await supabase.client
          .from('quotations')
          .select('status')
          .eq('id', id)
          .single();
        expect(data?.status).toBe(QuotationStatus.Expired);
      }

      for (const id of expectStillExpired) {
        const { data } = await supabase.client
          .from('quotations')
          .select('status')
          .eq('id', id)
          .single();
        expect(data?.status).toBe(QuotationStatus.Expired);
      }

      for (const id of expectUnchanged) {
        const { data } = await supabase.client
          .from('quotations')
          .select('status')
          .eq('id', id)
          .single();
        expect(data?.status).not.toBe(QuotationStatus.Expired);
      }

      expect(
        (
          await supabase.client
            .from('quotations')
            .select('status')
            .eq('id', acceptedPast.quotation.id)
            .single()
        ).data?.status,
      ).toBe(QuotationStatus.Accepted);
      expect(
        (
          await supabase.client
            .from('quotations')
            .select('status')
            .eq('id', declinedPast.quotation.id)
            .single()
        ).data?.status,
      ).toBe(QuotationStatus.Declined);
      expect(
        (
          await supabase.client
            .from('quotations')
            .select('status')
            .eq('id', draftFuture.quotation.id)
            .single()
        ).data?.status,
      ).toBe(QuotationStatus.Draft);

      const { data: secondCount, error: secondError } = await supabase.client.rpc(
        'expire_due_quotations',
        { p_company_id: companyId },
      );
      expect(secondError).toBeNull();
      expect(secondCount).toBe(0);
    });
  },
);
