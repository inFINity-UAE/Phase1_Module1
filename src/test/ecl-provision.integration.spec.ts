import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { Test, TestingModule } from '@nestjs/testing';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { PeriodStatus } from '../common/enums/period-status.enum';
import { CustomersModule } from '../customers/customers.module';
import { CustomersService } from '../customers/customers.service';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import { getAccountIdByNumber } from '../e2e/e2e-company.setup';
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
const PERIOD_END = '2026-06-30';
const SEED_ACTOR = '00000000-0000-0000-0000-0000000000d0';

/**
 * [feature-spec-1_1_D.md §4.5a / §4.5b]
 */
(hasSupabase ? describe : describe.skip)(
  'ECL provision + VAT relief (feature-spec-1_1_D.md §4.5)',
  () => {
    jest.setTimeout(180_000);

    let invoicesService: InvoicesService;
    let customersService: CustomersService;
    let supabase: SupabaseService;
    let companyId = '';
    let customerId = '';
    let overrideCustomerId = '';
    let incomeAccountId = '';
    let account1110 = '';
    let account5640 = '';
    const invoiceIds: string[] = [];

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, CustomersModule, InvoicesModule],
      }).compile();

      invoicesService = module.get(InvoicesService);
      customersService = module.get(CustomersService);
      supabase = module.get(SupabaseService);

      companyId = await mintFreshIntegrationCompany(supabase, 'ECL provision');
      incomeAccountId = await getAccountIdByNumber(supabase, companyId, '4000');
      account1110 = await getAccountIdByNumber(supabase, companyId, '1110');
      account5640 = await getAccountIdByNumber(supabase, companyId, '5640');

      const customer = await customersService.create({
        company_id: companyId,
        customer_name: 'ECL bucket customer',
      });
      customerId = customer.id;

      const override = await customersService.create({
        company_id: companyId,
        customer_name: 'ECL override customer',
      });
      overrideCustomerId = override.id;
      await supabase.client
        .from('customers')
        .update({
          ecl_override_rate: 0.5,
          ecl_override_reason: 'litigation risk',
        })
        .eq('id', overrideCustomerId);

      // Provisional seed rates for this company (§4.5 / seed_ecl_loss_rate_policies).
      const { error: rateErr } = await supabase.client.from('ecl_loss_rate_policies').insert([
        { company_id: companyId, bucket: 'current', loss_rate: 0.0075, effective_from: '2026-01-01', created_by: SEED_ACTOR },
        { company_id: companyId, bucket: '0_30', loss_rate: 0.02, effective_from: '2026-01-01', created_by: SEED_ACTOR },
        { company_id: companyId, bucket: '31_60', loss_rate: 0.075, effective_from: '2026-01-01', created_by: SEED_ACTOR },
        { company_id: companyId, bucket: '61_90', loss_rate: 0.2, effective_from: '2026-01-01', created_by: SEED_ACTOR },
        { company_id: companyId, bucket: '90_plus', loss_rate: 0.4, effective_from: '2026-01-01', created_by: SEED_ACTOR },
      ]);
      expect(rateErr).toBeNull();
    }, 120_000);

    afterAll(async () => {
      await supabase.client.from('ecl_provision_runs').delete().eq('company_id', companyId);
      for (const id of invoiceIds) {
        await supabase.client.from('write_offs').delete().eq('invoice_id', id);
        await supabase.client.from('invoice_lines').delete().eq('invoice_id', id);
        await supabase.client.from('invoices').delete().eq('id', id);
      }
      if (customerId) await supabase.client.from('customers').delete().eq('id', customerId);
      if (overrideCustomerId) {
        await supabase.client.from('customers').delete().eq('id', overrideCustomerId);
      }
      await supabase.client.from('ecl_loss_rate_policies').delete().eq('company_id', companyId);
    });

    async function issueInvoice(params: {
      customerId: string;
      invoiceDate: string;
      unitPrice: number;
      paymentTerms?: PaymentTermsType;
      customDays?: number;
    }): Promise<string> {
      const created = await invoicesService.create(
        {
          company_id: companyId,
          customer_id: params.customerId,
          invoice_date: params.invoiceDate,
          payment_terms: params.paymentTerms ?? PaymentTermsType.Net30,
          custom_days: params.customDays,
          lines: [
            {
              line_number: 1,
              description: 'Service',
              quantity: 1,
              unit_price: params.unitPrice,
              vat_rate: 0, // keep outstanding = unit_price for clear rate maths
              is_service: true,
              income_account_id: incomeAccountId,
            },
          ],
        },
        USER_ID,
      );
      invoiceIds.push(created.invoice.id);
      const issued = await invoicesService.issue(created.invoice.id);
      return issued.invoice.id;
    }

    it('§4.5a tops up 1110 from bucket rates + override; records ecl_provision_runs', async () => {
      // as_of 2026-06-30:
      // current: due >= 2026-06-30 → invoice 2026-06-15 Net30 due 2026-07-15, outstanding 1000 → 7.50
      await issueInvoice({
        customerId,
        invoiceDate: '2026-06-15',
        unitPrice: 1000,
      });
      // 31_60: due 2026-05-01 → days = 60 → bucket 31_60, outstanding 2000 → 150
      await issueInvoice({
        customerId,
        invoiceDate: '2026-04-01',
        unitPrice: 2000,
        paymentTerms: PaymentTermsType.Custom,
        customDays: 30, // due 2026-05-01; 2026-06-30 - 2026-05-01 = 60 days → 31_60
      });
      // override customer: 500 × 0.5 = 250 (ignores buckets)
      await issueInvoice({
        customerId: overrideCustomerId,
        invoiceDate: '2026-01-01',
        unitPrice: 500,
        paymentTerms: PaymentTermsType.Custom,
        customDays: 1,
      });

      // required = 7.50 + 150 + 250 = 407.50; prior = 0; adjustment = 407.50
      const { data, error } = await supabase.client.rpc('run_ecl_provision', {
        p_company_id: companyId,
        p_period_end_date: PERIOD_END,
        p_created_by: USER_ID,
      });
      expect(error).toBeNull();
      expect(Number(data.run.required_allowance)).toBe(407.5);
      expect(Number(data.run.prior_allowance)).toBe(0);
      expect(Number(data.run.adjustment_amount)).toBe(407.5);
      expect(data.run.reviewed_by).toBeNull();
      expect(data.journal_entry_id).toBeTruthy();

      const { data: entry } = await supabase.client
        .from('journal_entries')
        .select('entry_type, status')
        .eq('id', data.journal_entry_id)
        .single();
      expect(entry!.entry_type).toBe(JournalEntryType.EclProvision);
      expect(entry!.status).toBe(JournalEntryStatus.Posted);

      const { data: lines } = await supabase.client
        .from('journal_lines')
        .select('account_id, debit, credit')
        .eq('journal_entry_id', data.journal_entry_id)
        .order('line_number');
      expect(lines![0].account_id).toBe(account5640);
      expect(Number(lines![0].debit)).toBe(407.5);
      expect(lines![1].account_id).toBe(account1110);
      expect(Number(lines![1].credit)).toBe(407.5);
    });

    it('§4.5a rejects second run for same period_end and closed period', async () => {
      const { error: dupErr } = await supabase.client.rpc('run_ecl_provision', {
        p_company_id: companyId,
        p_period_end_date: PERIOD_END,
        p_created_by: USER_ID,
      });
      expect(dupErr).toBeTruthy();
      expect(dupErr!.message).toMatch(/ECL_PROVISION_ALREADY_RUN/);

      // Close July period then refuse ECL for July month-end.
      await supabase.client
        .from('accounting_periods')
        .update({ status: PeriodStatus.Closed })
        .eq('company_id', companyId)
        .eq('period_start', '2026-07-01');

      const { error: closedErr } = await supabase.client.rpc('run_ecl_provision', {
        p_company_id: companyId,
        p_period_end_date: '2026-07-31',
        p_created_by: USER_ID,
      });
      expect(closedErr).toBeTruthy();
      expect(closedErr!.message).toMatch(/ACCOUNTING_PERIOD_CLOSED/);
    });

    it('§4.5a release posts Dr 1110 Cr 5640 when required < prior', async () => {
      // Fresh company month with no open AR but prior allowance left from a seed JE
      // — use August: fund 1110 then run with zero open invoices.
      const seedCompany = await mintFreshIntegrationCompany(supabase, 'ECL release');
      await supabase.client.from('ecl_loss_rate_policies').insert([
        { company_id: seedCompany, bucket: 'current', loss_rate: 0.0075, effective_from: '2026-01-01', created_by: SEED_ACTOR },
        { company_id: seedCompany, bucket: '0_30', loss_rate: 0.02, effective_from: '2026-01-01', created_by: SEED_ACTOR },
        { company_id: seedCompany, bucket: '31_60', loss_rate: 0.075, effective_from: '2026-01-01', created_by: SEED_ACTOR },
        { company_id: seedCompany, bucket: '61_90', loss_rate: 0.2, effective_from: '2026-01-01', created_by: SEED_ACTOR },
        { company_id: seedCompany, bucket: '90_plus', loss_rate: 0.4, effective_from: '2026-01-01', created_by: SEED_ACTOR },
      ]);

      const a1110 = await getAccountIdByNumber(supabase, seedCompany, '1110');
      const a5640 = await getAccountIdByNumber(supabase, seedCompany, '5640');
      const { data: period } = await supabase.client
        .from('accounting_periods')
        .select('id')
        .eq('company_id', seedCompany)
        .eq('period_start', '2026-08-01')
        .single();

      const { data: je, error: jeErr } = await supabase.client
        .from('journal_entries')
        .insert({
          company_id: seedCompany,
          entry_number: 1,
          period_id: period!.id,
          entry_date: '2026-08-01',
          entry_type: JournalEntryType.Manual,
          status: JournalEntryStatus.Draft,
          narration: 'seed allowance',
          created_by: USER_ID,
        })
        .select('id')
        .single();
      expect(jeErr).toBeNull();
      await supabase.client.from('journal_lines').insert([
        { journal_entry_id: je!.id, line_number: 1, account_id: a5640, debit: 100, credit: 0 },
        { journal_entry_id: je!.id, line_number: 2, account_id: a1110, debit: 0, credit: 100 },
      ]);
      await supabase.client
        .from('journal_entries')
        .update({ status: JournalEntryStatus.Posted })
        .eq('id', je!.id);

      const { data, error } = await supabase.client.rpc('run_ecl_provision', {
        p_company_id: seedCompany,
        p_period_end_date: '2026-08-31',
        p_created_by: USER_ID,
      });
      expect(error).toBeNull();
      expect(Number(data.run.required_allowance)).toBe(0);
      expect(Number(data.run.prior_allowance)).toBe(100);
      expect(Number(data.run.adjustment_amount)).toBe(-100);

      const { data: lines } = await supabase.client
        .from('journal_lines')
        .select('account_id, debit, credit')
        .eq('journal_entry_id', data.journal_entry_id)
        .order('line_number');
      expect(lines![0].account_id).toBe(a1110);
      expect(Number(lines![0].debit)).toBe(100);
      expect(lines![1].account_id).toBe(a5640);
      expect(Number(lines![1].credit)).toBe(100);

      await supabase.client.from('ecl_provision_runs').delete().eq('company_id', seedCompany);
      await supabase.client.from('ecl_loss_rate_policies').delete().eq('company_id', seedCompany);
    });

    it('§4.5b flips vat_relief_eligible when 6mo + debtor_notified_at', async () => {
      const oldId = await issueInvoice({
        customerId,
        invoiceDate: '2026-02-01',
        unitPrice: 100,
      });
      // Write-off via RPC+post path
      await invoicesService.writeOff(
        oldId,
        { reason: 'bad debt', debtor_notified_at: '2026-03-15' },
        USER_ID,
      );

      const recentId = await issueInvoice({
        customerId,
        invoiceDate: '2026-06-01',
        unitPrice: 50,
      });
      await invoicesService.writeOff(
        recentId,
        { reason: 'recent', debtor_notified_at: '2026-06-15' },
        USER_ID,
      );

      // as_of 2026-09-01: Feb invoice is ≥6 months old; June is not.
      const { data: count, error } = await supabase.client.rpc('mark_vat_relief_eligible', {
        p_company_id: companyId,
        p_as_of_date: '2026-09-01',
      });
      expect(error).toBeNull();
      expect(count).toBe(1);

      const { data: rows } = await supabase.client
        .from('write_offs')
        .select('invoice_id, vat_relief_eligible, vat_relief_flagged_at')
        .in('invoice_id', [oldId, recentId]);

      const old = rows!.find((r) => r.invoice_id === oldId)!;
      const recent = rows!.find((r) => r.invoice_id === recentId)!;
      expect(old.vat_relief_eligible).toBe(true);
      expect(old.vat_relief_flagged_at).toBeTruthy();
      expect(recent.vat_relief_eligible).toBe(false);
    });
  },
);
