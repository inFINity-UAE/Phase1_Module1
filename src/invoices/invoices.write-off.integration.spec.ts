import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { Test, TestingModule } from '@nestjs/testing';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { CompanyRole } from '../common/enums/company-role.enum';
import { CustomersModule } from '../customers/customers.module';
import { CustomersService } from '../customers/customers.service';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import { getAccountIdByNumber } from '../e2e/e2e-company.setup';
import { InvoiceStatus } from '../invoices/common/enums/invoice-status.enum';
import { PaymentTermsType } from '../invoices/common/enums/payment-terms-type.enum';
import { InvoicesModule } from '../invoices/invoices.module';
import { InvoicesService } from '../invoices/invoices.service';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import {
  INTEGRATION_ACCOUNTANT_ID,
  INTEGRATION_USER_ID,
  mintFreshIntegrationCompany,
} from '../test/integration-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const OWNER_ID = INTEGRATION_USER_ID;

/**
 * [feature-spec-1_1_D.md §4.4 / D-8 / D-9 / D-11]
 */
(hasSupabase ? describe : describe.skip)(
  'Invoice write-off (feature-spec-1_1_D.md §4.4)',
  () => {
    jest.setTimeout(180_000);

    let invoicesService: InvoicesService;
    let customersService: CustomersService;
    let journalEntriesService: JournalEntriesService;
    let supabase: SupabaseService;
    let companyId = '';
    let customerId = '';
    let incomeAccountId = '';
    let account1100 = '';
    let account1110 = '';
    let account5640 = '';
    const invoiceIds: string[] = [];

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, CustomersModule, InvoicesModule, JournalEntriesModule],
      }).compile();

      invoicesService = module.get(InvoicesService);
      customersService = module.get(CustomersService);
      journalEntriesService = module.get(JournalEntriesService);
      supabase = module.get(SupabaseService);

      companyId = await mintFreshIntegrationCompany(supabase, 'Write-off', {
        withAccountant: true,
      });
      const customer = await customersService.create({
        company_id: companyId,
        customer_name: 'Write-off customer',
      });
      customerId = customer.id;
      incomeAccountId = await getAccountIdByNumber(supabase, companyId, '4000');
      account1100 = await getAccountIdByNumber(supabase, companyId, '1100');
      account1110 = await getAccountIdByNumber(supabase, companyId, '1110');
      account5640 = await getAccountIdByNumber(supabase, companyId, '5640');
    }, 120_000);

    afterAll(async () => {
      for (const id of invoiceIds) {
        await supabase.client.from('write_offs').delete().eq('invoice_id', id);
        await supabase.client.from('invoice_lines').delete().eq('invoice_id', id);
        await supabase.client.from('invoices').delete().eq('id', id);
      }
      if (customerId) {
        await supabase.client.from('customers').delete().eq('id', customerId);
      }
    });

    async function createIssuedInvoice(unitPrice: number): Promise<{
      id: string;
      grandTotal: number;
    }> {
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
        OWNER_ID,
      );
      invoiceIds.push(created.invoice.id);
      const issued = await invoicesService.issue(created.invoice.id);
      return {
        id: issued.invoice.id,
        grandTotal: Number(issued.invoice.grand_total),
      };
    }

    async function fundAllowance(amount: number): Promise<void> {
      // Seed 1110 credit balance via a posted provision-style entry (Dr 5640 Cr 1110).
      const { data: periods } = await supabase.client
        .from('accounting_periods')
        .select('id')
        .eq('company_id', companyId)
        .eq('status', 'open')
        .lte('period_start', '2026-09-10')
        .gt('period_end', '2026-09-10')
        .limit(1);
      const periodId = periods![0].id;

      const draft = await journalEntriesService.create(
        {
          company_id: companyId,
          period_id: periodId,
          entry_date: '2026-09-10',
          narration: 'Test ECL allowance seed',
          lines: [
            {
              line_number: 1,
              account_id: account5640,
              debit: amount,
              credit: 0,
              description: 'Bad debt expense seed',
            },
            {
              line_number: 2,
              account_id: account1110,
              debit: 0,
              credit: amount,
              description: 'ECL allowance seed',
            },
          ],
        },
        OWNER_ID,
      );
      await journalEntriesService.post(draft.entry.id, OWNER_ID, {}, CompanyRole.Owner);
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

    it('§4.4 shortfall posts Dr 5640 when 1110 balance is insufficient', async () => {
      const inv = await createIssuedInvoice(1000); // 1050 due; no allowance funded → full shortfall

      const result = await invoicesService.writeOff(
        inv.id,
        { reason: 'Uncollectible — no provision' },
        OWNER_ID,
        CompanyRole.Owner,
      );
      expect(result.invoice.status).toBe(InvoiceStatus.WrittenOff);

      const { data: wo } = await supabase.client
        .from('write_offs')
        .select('journal_entry_id, amount')
        .eq('invoice_id', inv.id)
        .single();
      expect(Number(wo!.amount)).toBe(1050);

      const lines = await journalLines(wo!.journal_entry_id);
      expect(lines).toHaveLength(2);
      expect(lines[0].account_id).toBe(account5640);
      expect(Number(lines[0].debit)).toBe(1050);
      expect(lines[1].account_id).toBe(account1100);
      expect(Number(lines[1].credit)).toBe(1050);
    });

    it('§4.4 partial allowance: Dr 1110 for available + Dr 5640 shortfall', async () => {
      const inv = await createIssuedInvoice(1000); // 1050
      await fundAllowance(400);

      await invoicesService.writeOff(
        inv.id,
        { reason: 'Partial provision drawdown' },
        OWNER_ID,
        CompanyRole.Owner,
      );

      const { data: wo } = await supabase.client
        .from('write_offs')
        .select('journal_entry_id')
        .eq('invoice_id', inv.id)
        .single();

      const lines = await journalLines(wo!.journal_entry_id);
      expect(lines).toHaveLength(3);
      expect(lines[0].account_id).toBe(account1110);
      expect(Number(lines[0].debit)).toBe(400);
      expect(lines[1].account_id).toBe(account5640);
      expect(Number(lines[1].debit)).toBe(650);
      expect(lines[2].account_id).toBe(account1100);
      expect(Number(lines[2].credit)).toBe(1050);
    });

    it('§4.4 writes off unpaid balance Dr 1110 Cr 1100 when allowance covers', async () => {
      const inv = await createIssuedInvoice(1000); // grand_total 1050
      expect(inv.grandTotal).toBe(1050);
      await fundAllowance(2000);

      const result = await invoicesService.writeOff(
        inv.id,
        { reason: 'Customer insolvent', debtor_notified_at: '2026-09-01' },
        OWNER_ID,
        CompanyRole.Owner,
      );
      expect(result.invoice.status).toBe(InvoiceStatus.WrittenOff);

      const { data: wo } = await supabase.client
        .from('write_offs')
        .select('*')
        .eq('invoice_id', inv.id)
        .single();
      expect(Number(wo!.amount)).toBe(1050);
      expect(wo!.reason).toBe('Customer insolvent');
      expect(wo!.debtor_notified_at).toBe('2026-09-01');

      const { data: entry } = await supabase.client
        .from('journal_entries')
        .select('status, entry_type')
        .eq('id', wo!.journal_entry_id)
        .single();
      expect(entry!.status).toBe(JournalEntryStatus.Posted);
      expect(entry!.entry_type).toBe(JournalEntryType.WriteOff);

      const lines = await journalLines(wo!.journal_entry_id);
      expect(lines).toHaveLength(2);
      expect(lines[0].account_id).toBe(account1110);
      expect(Number(lines[0].debit)).toBe(1050);
      expect(lines[1].account_id).toBe(account1100);
      expect(Number(lines[1].credit)).toBe(1050);
    });

    it('D-11: non-Owner write-off at/above write_off_approval_threshold → pending_approval', async () => {
      // 5000 + 5% = 5250 >= default write_off_approval_threshold 5000
      const inv = await createIssuedInvoice(5000);

      const result = await invoicesService.writeOff(
        inv.id,
        { reason: 'Large write-off needs approval' },
        INTEGRATION_ACCOUNTANT_ID,
        CompanyRole.Accountant,
      );
      expect(result.invoice.status).toBe(InvoiceStatus.WrittenOff);

      const { data: wo } = await supabase.client
        .from('write_offs')
        .select('journal_entry_id')
        .eq('invoice_id', inv.id)
        .single();

      const { data: entry } = await supabase.client
        .from('journal_entries')
        .select('status, requires_approval, entry_type')
        .eq('id', wo!.journal_entry_id)
        .single();
      expect(entry!.entry_type).toBe(JournalEntryType.WriteOff);
      expect(entry!.status).toBe(JournalEntryStatus.PendingApproval);
      expect(entry!.requires_approval).toBe(true);
    });

    it('rejects write-off on draft invoice', async () => {
      const created = await invoicesService.create(
        {
          company_id: companyId,
          customer_id: customerId,
          invoice_date: '2026-06-01',
          payment_terms: PaymentTermsType.Net30,
          lines: [
            {
              line_number: 1,
              description: 'Draft',
              quantity: 1,
              unit_price: 100,
              vat_rate: 5,
              is_service: true,
              income_account_id: incomeAccountId,
            },
          ],
        },
        OWNER_ID,
      );
      invoiceIds.push(created.invoice.id);

      await expect(
        invoicesService.writeOff(created.invoice.id, { reason: 'nope' }, OWNER_ID),
      ).rejects.toThrow(/Cannot transition/);
    });
  },
);
