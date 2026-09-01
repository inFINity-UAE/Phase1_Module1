import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { Test, TestingModule } from '@nestjs/testing';
import { CustomersModule } from '../customers/customers.module';
import { CustomersService } from '../customers/customers.service';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import { getAccountIdByNumber } from '../e2e/e2e-company.setup';
import { InvoicesModule } from '../invoices/invoices.module';
import { InvoicesService } from '../invoices/invoices.service';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import {
  INTEGRATION_USER_ID,
  mintFreshIntegrationCompany,
} from '../test/integration-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const USER_ID = INTEGRATION_USER_ID;
const TB_CONCURRENCY = 8;
const CNL_RACE_PAIRS = 6;

/**
 * Diagnostic: trial-balance reads vs cnl: advisory-lock line INSERTs under
 * deliberate co-load. A failure here would indicate cnl: contention affecting
 * reporting; passing under this probe supports infra-saturation (pool/timeout)
 * as the full-suite flake cause — not lock coupling.
 */
(hasSupabase ? describe : describe.skip)(
  'Trial balance vs cnl: lock co-stress (diagnostic)',
  () => {
    jest.setTimeout(240_000);

    let supabase: SupabaseService;
    let invoicesService: InvoicesService;
    let journalService: JournalEntriesService;
    let customersService: CustomersService;
    let companyId = '';
    let febPeriodId = '';
    let invoiceLineId = '';
    const creditNoteHeaderIds: string[] = [];

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, CustomersModule, InvoicesModule, JournalEntriesModule],
      }).compile();

      supabase = module.get(SupabaseService);
      invoicesService = module.get(InvoicesService);
      journalService = module.get(JournalEntriesService);
      customersService = module.get(CustomersService);

      companyId = await mintFreshIntegrationCompany(supabase, 'TB vs cnl stress');

      const customer = await customersService.create({
        company_id: companyId,
        customer_name: 'Stress customer',
        trn: `1${Date.now()}`.slice(0, 15),
      });

      const { data: febPeriod } = await supabase.client
        .from('accounting_periods')
        .select('id')
        .eq('company_id', companyId)
        .eq('period_start', '2026-02-01')
        .single();
      febPeriodId = febPeriod!.id as string;

      const janPeriod = await supabase.client
        .from('accounting_periods')
        .select('id')
        .eq('company_id', companyId)
        .eq('period_start', '2026-01-01')
        .single();

      const bankId = await getAccountIdByNumber(supabase, companyId, '1020');
      const expenseId = await getAccountIdByNumber(supabase, companyId, '5990');
      const incomeAccountId = await getAccountIdByNumber(supabase, companyId, '4000');

      const draft = await journalService.create(
        {
          company_id: companyId,
          period_id: janPeriod.data!.id as string,
          entry_date: '2026-01-15',
          narration: 'TB stress seed',
          lines: [
            { line_number: 1, account_id: expenseId, debit: 250, credit: 0 },
            { line_number: 2, account_id: bankId, debit: 0, credit: 250 },
          ],
        },
        USER_ID,
      );
      await journalService.post(draft.entry.id, USER_ID);

      const invoice = await invoicesService.create(
        {
          company_id: companyId,
          customer_id: customer.id,
          invoice_date: '2026-06-15',
          lines: [
            {
              line_number: 1,
              description: 'cnl stress line',
              quantity: 1,
              unit_price: 200,
              vat_rate: 5,
              income_account_id: incomeAccountId,
            },
          ],
        },
        USER_ID,
      );
      await invoicesService.issue(invoice.invoice.id);
      invoiceLineId = invoice.lines[0].id;

      for (let i = 0; i < CNL_RACE_PAIRS * 2; i++) {
        const { data: inv } = await supabase.client
          .from('invoices')
          .select('customer_id')
          .eq('id', invoice.invoice.id)
          .single();
        const { data: cn } = await supabase.client
          .from('credit_notes')
          .insert({
            company_id: companyId,
            customer_id: inv!.customer_id,
            original_invoice_id: invoice.invoice.id,
            credit_note_date: '2026-07-01',
            created_by: USER_ID,
            status: 'draft',
          })
          .select('id')
          .single();
        creditNoteHeaderIds.push(cn!.id as string);
      }
    }, 120_000);

    afterAll(async () => {
      for (const cnId of creditNoteHeaderIds) {
        await supabase.client.from('credit_note_lines').delete().eq('credit_note_id', cnId);
      }
      await supabase.client.from('credit_notes').delete().eq('company_id', companyId);
    });

    it('concurrent get_trial_balance_for_period succeeds while cnl: line INSERT races run', async () => {
      const cnlInserts = creditNoteHeaderIds.slice(0, CNL_RACE_PAIRS * 2).map((cnId, idx) =>
        supabase.client.from('credit_note_lines').insert({
          credit_note_id: cnId,
          line_number: 1,
          description: `Stress ${idx}`,
          quantity: 1,
          unit_price: 200,
          vat_rate: 0,
          original_invoice_line_id: invoiceLineId,
        }),
      );

      const tbCalls = Array.from({ length: TB_CONCURRENCY }, () =>
        supabase.client.rpc('get_trial_balance_for_period', {
          p_company_id: companyId,
          p_period_id: febPeriodId,
          p_include_zero_balance: false,
        }),
      );

      const started = Date.now();
      const results = await Promise.allSettled([...cnlInserts, ...tbCalls]);
      const elapsedMs = Date.now() - started;

      const tbResults = results.slice(cnlInserts.length);
      const cnlResults = results.slice(0, cnlInserts.length);

      for (const r of tbResults) {
        expect(r.status).toBe('fulfilled');
        if (r.status === 'fulfilled') {
          expect(r.value.error).toBeNull();
          expect(Array.isArray(r.value.data)).toBe(true);
        }
      }

      const cnlOk = cnlResults.filter(
        (r) => r.status === 'fulfilled' && !(r.value as { error: unknown }).error,
      );
      const cnlFail = cnlResults.length - cnlOk.length;
      expect(cnlOk.length).toBeGreaterThanOrEqual(1);
      expect(cnlFail).toBeGreaterThanOrEqual(1);

      // eslint-disable-next-line no-console
      console.log(
        `[tb-vs-cnl] elapsedMs=${elapsedMs} tb=${TB_CONCURRENCY}/${TB_CONCURRENCY} ok cnl=${cnlOk.length}/${cnlInserts.length} ok`,
      );
    });
  },
);
