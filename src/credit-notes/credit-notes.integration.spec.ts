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
import { InvoicesModule } from '../invoices/invoices.module';
import { InvoicesService } from '../invoices/invoices.service';
import {
  INTEGRATION_USER_ID,
  mintFreshIntegrationCompany,
} from '../test/integration-company.setup';
import { CreditNotesModule } from './credit-notes.module';
import { CreditNotesService } from './credit-notes.service';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const USER_ID = INTEGRATION_USER_ID;
const CREDIT_NOTE_DATE = '2026-07-01';
const INVOICE_DATE = '2026-06-15';

(hasSupabase ? describe : describe.skip)(
  'Credit notes (feature-spec-1.1.C.md §1.4 C1-4)',
  () => {
    jest.setTimeout(180_000);

    let creditNotesService: CreditNotesService;
    let invoicesService: InvoicesService;
    let customersService: CustomersService;
    let supabase: SupabaseService;
    let companyId = '';
    let customerId = '';
    let invoiceIncomeAccountId = '';
    const createdCreditNoteIds: string[] = [];
    const createdInvoiceIds: string[] = [];

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, CustomersModule, InvoicesModule, CreditNotesModule],
      }).compile();

      creditNotesService = module.get(CreditNotesService);
      invoicesService = module.get(InvoicesService);
      customersService = module.get(CustomersService);
      supabase = module.get(SupabaseService);

      companyId = await mintFreshIntegrationCompany(supabase, 'Credit notes C1-4');
      const customer = await customersService.create({
        company_id: companyId,
        customer_name: 'Credit note customer',
        trn: `1${Date.now()}`.slice(0, 15),
      });
      customerId = customer.id;
      invoiceIncomeAccountId = await getAccountIdByNumber(supabase, companyId, '4000');
    }, 120000);

    afterAll(async () => {
      for (const id of createdCreditNoteIds.reverse()) {
        await supabase.client.from('credit_note_lines').delete().eq('credit_note_id', id);
        await supabase.client.from('credit_notes').delete().eq('id', id);
      }
      for (const id of createdInvoiceIds.reverse()) {
        await supabase.client.from('invoice_lines').delete().eq('invoice_id', id);
        await supabase.client.from('invoices').delete().eq('id', id);
      }
      await supabase.client.from('customers').delete().eq('id', customerId);
    });

    async function mintIssuedInvoiceLine(unitPrice: number) {
      const invoice = await invoicesService.create(
        {
          company_id: companyId,
          customer_id: customerId,
          invoice_date: INVOICE_DATE,
          lines: [
            {
              line_number: 1,
              description: 'Creditable supply',
              quantity: 1,
              unit_price: unitPrice,
              vat_rate: 5,
              is_service: false,
              income_account_id: invoiceIncomeAccountId,
            },
          ],
        },
        USER_ID,
      );
      createdInvoiceIds.push(invoice.invoice.id);
      await invoicesService.issue(invoice.invoice.id);
      return {
        invoiceId: invoice.invoice.id,
        lineId: invoice.lines[0].id,
        lineTotal: Number(invoice.lines[0].line_total),
      };
    }

    async function createDraftCreditNote(
      invoiceId: string,
      lineId: string,
      unitPrice: number,
      opts?: { reason?: string; omitOriginalLine?: boolean; vat_rate?: number },
    ) {
      const created = await creditNotesService.create(
        {
          company_id: companyId,
          original_invoice_id: invoiceId,
          credit_note_date: CREDIT_NOTE_DATE,
          lines: [
            {
              line_number: 1,
              description: 'Credit line',
              quantity: 1,
              unit_price: unitPrice,
              original_invoice_line_id: opts?.omitOriginalLine ? undefined : lineId,
              reason: opts?.reason,
              vat_rate: opts?.vat_rate,
            },
          ],
        },
        USER_ID,
      );
      createdCreditNoteIds.push(created.credit_note.id);
      return created;
    }

    async function insertDraftCreditNoteHeader(invoiceId: string) {
      const { data: invoice } = await supabase.client
        .from('invoices')
        .select('customer_id, company_id')
        .eq('id', invoiceId)
        .single();

      const { data, error } = await supabase.client
        .from('credit_notes')
        .insert({
          company_id: invoice!.company_id,
          customer_id: invoice!.customer_id,
          original_invoice_id: invoiceId,
          credit_note_date: CREDIT_NOTE_DATE,
          created_by: USER_ID,
          status: 'draft',
        })
        .select('id')
        .single();

      if (error) {
        throw error;
      }
      createdCreditNoteIds.push(data!.id as string);
      return data!.id as string;
    }

    it('copies vat_rate and income_account_id from invoice line and keeps them read-only', async () => {
      const { invoiceId, lineId } = await mintIssuedInvoiceLine(1000);
      const created = await createDraftCreditNote(invoiceId, lineId, 100);

      expect(Number(created.lines[0].vat_rate)).toBe(5);
      expect(created.lines[0].income_account_id).toBe(invoiceIncomeAccountId);

      const { error } = await supabase.client
        .from('credit_note_lines')
        .update({ vat_rate: 0 })
        .eq('id', created.lines[0].id);

      expect(error?.message).toMatch(/CREDIT_NOTE_LINE_DERIVED_FIELDS_IMMUTABLE/);
    });

    it('rejects a single credit exceeding the original line_total', async () => {
      const { invoiceId, lineId } = await mintIssuedInvoiceLine(1000);

      await expect(createDraftCreditNote(invoiceId, lineId, 1001)).rejects.toThrow(
        /CREDIT_NOTE_LINE_CUMULATIVE_CAP_EXCEEDED/,
      );
    });

    it('allows two credits up to the exact remaining cap then rejects a third', async () => {
      const { invoiceId, lineId, lineTotal } = await mintIssuedInvoiceLine(1000);
      expect(lineTotal).toBe(1050);

      const first = await createDraftCreditNote(invoiceId, lineId, 500);
      expect(Number(first.lines[0].line_total)).toBe(525);

      const second = await createDraftCreditNote(invoiceId, lineId, 500);
      expect(Number(second.lines[0].line_total)).toBe(525);

      await expect(createDraftCreditNote(invoiceId, lineId, 0.01)).rejects.toThrow(
        /CREDIT_NOTE_LINE_CUMULATIVE_CAP_EXCEEDED/,
      );
    });

    it('concurrent line INSERTs via Promise.all exercise cnl: advisory lock', async () => {
      const { invoiceId, lineId, lineTotal } = await mintIssuedInvoiceLine(200);

      // Setup: two draft headers (sequential — not the race under test).
      const creditNoteA = await insertDraftCreditNoteHeader(invoiceId);
      const creditNoteB = await insertDraftCreditNoteHeader(invoiceId);

      // Race: simultaneous line INSERTs against the same original_invoice_line_id.
      const attempts = await Promise.allSettled([
        supabase.client.from('credit_note_lines').insert({
          credit_note_id: creditNoteA,
          line_number: 1,
          description: 'Race A',
          quantity: 1,
          unit_price: 200,
          vat_rate: 0,
          original_invoice_line_id: lineId,
        }),
        supabase.client.from('credit_note_lines').insert({
          credit_note_id: creditNoteB,
          line_number: 1,
          description: 'Race B',
          quantity: 1,
          unit_price: 200,
          vat_rate: 0,
          original_invoice_line_id: lineId,
        }),
      ]);

      const successes = attempts.filter((r) => r.status === 'fulfilled' && !(r.value as { error: unknown }).error);
      const failures = attempts.filter(
        (r) =>
          r.status === 'rejected' ||
          (r.status === 'fulfilled' && (r.value as { error: unknown }).error),
      );

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);

      const { data: credited } = await supabase.client
        .from('credit_note_lines')
        .select('line_total, credit_notes!inner(status)')
        .eq('original_invoice_line_id', lineId);

      const total = (credited ?? [])
        .filter((row) => {
          const parent = row.credit_notes as { status: string } | { status: string }[];
          const status = Array.isArray(parent) ? parent[0]?.status : parent?.status;
          return status !== 'void';
        })
        .reduce((sum, row) => sum + Number(row.line_total), 0);

      expect(total).toBeLessThanOrEqual(lineTotal);
    });

    it('recalc trigger fires exactly once per line UPDATE (no header→line cascade)', async () => {
      const { invoiceId, lineId } = await mintIssuedInvoiceLine(100);
      const created = await createDraftCreditNote(invoiceId, lineId, 10);

      const { data, error } = await supabase.client.rpc(
        'integration_verify_credit_note_recalc_fires_once',
        {
          p_line_id: created.lines[0].id,
          p_quantity: 2,
        },
      );

      expect(error).toBeNull();
      expect(data).toEqual({ line_trigger_fires: 1, recalc_calls: 1 });
    });

    it('Issue transition does not fire line→header recalc cascade', async () => {
      const { invoiceId, lineId } = await mintIssuedInvoiceLine(50);
      const draft = await createDraftCreditNote(invoiceId, lineId, 10);

      const { data, error } = await supabase.client.rpc(
        'integration_verify_credit_note_issue_no_recalc',
        { p_credit_note_id: draft.credit_note.id },
      );

      expect(error).toBeNull();
      expect(data).toEqual({ line_trigger_fires: 0, recalc_calls: 0 });
    });

    it('general adjustment requires reason — rejected without one', async () => {
      const { invoiceId } = await mintIssuedInvoiceLine(100);

      await expect(
        creditNotesService.create(
          {
            company_id: companyId,
            original_invoice_id: invoiceId,
            credit_note_date: CREDIT_NOTE_DATE,
            lines: [
              {
                line_number: 1,
                description: 'General adjustment',
                quantity: 1,
                unit_price: 10,
                vat_rate: 5,
              },
            ],
          },
          USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);

      const { data: header, error: headerErr } = await supabase.client
        .from('credit_notes')
        .insert({
          company_id: companyId,
          customer_id: customerId,
          original_invoice_id: invoiceId,
          credit_note_date: CREDIT_NOTE_DATE,
          created_by: USER_ID,
          status: 'draft',
        })
        .select('id')
        .single();
      expect(headerErr).toBeNull();
      createdCreditNoteIds.push(header!.id as string);

      const { error: lineErr } = await supabase.client.from('credit_note_lines').insert({
        credit_note_id: header!.id,
        line_number: 1,
        description: 'Missing reason',
        quantity: 1,
        unit_price: 10,
        vat_rate: 5,
        original_invoice_line_id: null,
        reason: null,
      });

      expect(lineErr?.message).toMatch(/credit_note_lines_reason_required|check constraint/i);
    });

    it('issue allocates credit_note_number and defers ledger posting', async () => {
      const { invoiceId, lineId } = await mintIssuedInvoiceLine(50);

      const draft = await createDraftCreditNote(invoiceId, lineId, 10);
      expect(draft.credit_note.credit_note_number).toBeNull();

      const issued = await creditNotesService.issue(draft.credit_note.id);
      expect(issued.ledger_posting_status).toBe('deferred_batch_2');
      expect(issued.journal_entry_id).toBeNull();
      expect(issued.credit_note.journal_entry_id).toBeNull();
      expect(issued.credit_note.credit_note_number).toMatch(/^CRN-2026-\d{4}$/);
    });
  },
);
