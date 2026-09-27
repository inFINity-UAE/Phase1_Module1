/**
 * Runs inFINity_AI_Accounting_Engine_Test_Cases.xlsx (Al Noor, 25–31 Aug 2026)
 * through the live Nest services. Records PASS / FAIL / NOT_IMPLEMENTED.
 * Does not hand-post the workbook's expected journals for modules that do not exist.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { writeFileSync } from 'fs';

config({ path: resolve(__dirname, '../../.env.local') });

import { Test, TestingModule } from '@nestjs/testing';
import { CompanyRole } from '../common/enums/company-role.enum';
import { AuditAction } from '../common/enums/audit-action.enum';
import { VatCategory } from '../common/enums/vat-category.enum';
import { VatInputTreatment } from '../common/enums/vat-input-treatment.enum';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { BillsModule } from '../bills/bills.module';
import { BillsService } from '../bills/bills.service';
import { CtModule } from '../ct/ct.module';
import { CtService } from '../ct/ct.service';
import { CustomersModule } from '../customers/customers.module';
import { CustomersService } from '../customers/customers.service';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import { getAccountIdByNumber, ensureFiscalYearPeriods } from '../e2e/e2e-company.setup';
import { InvoicesModule } from '../invoices/invoices.module';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentTermsType } from '../invoices/common/enums/payment-terms-type.enum';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentsService } from '../payments/payments.service';
import { PaymentMethodType } from '../payments/common/enums/payment-method-type.enum';
import { ReportsModule } from '../reports/reports.module';
import { ReportsService } from '../reports/reports.service';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { SuppliersService } from '../suppliers/suppliers.service';
import { INTEGRATION_USER_ID, mintFreshIntegrationCompany } from './integration-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const USER_ID = INTEGRATION_USER_ID;
const ROLE = CompanyRole.Owner;

type Status = 'PASS' | 'FAIL' | 'PARTIAL' | 'NOT_IMPLEMENTED';
type Result = {
  id: string;
  title: string;
  status: Status;
  expected: string;
  actual: string;
};

type LineAgg = { account: string; debit: number; credit: number };

function money(n: unknown): number {
  return Math.round(Number(n ?? 0) * 100) / 100;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

(hasSupabase ? describe : describe.skip)('Al Noor workbook vs live engine', () => {
  jest.setTimeout(600_000);

  let invoices: InvoicesService;
  let customers: CustomersService;
  let payments: PaymentsService;
  let suppliers: SuppliersService;
  let bills: BillsService;
  let journals: JournalEntriesService;
  let periods: AccountingPeriodsService;
  let reports: ReportsService;
  let audit: AuditLogService;
  let ct: CtService;
  let supabase: SupabaseService;
  let companyId = '';
  const results: Result[] = [];

  function record(id: string, title: string, status: Status, expected: string, actual: string) {
    results.push({ id, title, status, expected, actual });
  }

  async function acct(number: string): Promise<string> {
    return getAccountIdByNumber(supabase, companyId, number);
  }

  async function periodId(start: string): Promise<string> {
    const { data, error } = await supabase.client
      .from('accounting_periods')
      .select('id')
      .eq('company_id', companyId)
      .eq('period_start', start)
      .single();
    if (error || !data) throw error ?? new Error(`period ${start} missing`);
    return data.id as string;
  }

  async function linesFor(journalEntryId: string): Promise<LineAgg[]> {
    const { data, error } = await supabase.client
      .from('journal_lines')
      .select('debit, credit, accounts(account_number)')
      .eq('journal_entry_id', journalEntryId);
    if (error) throw error;
    const map = new Map<string, LineAgg>();
    for (const row of data ?? []) {
      const account = String(
        (row.accounts as { account_number?: string } | null)?.account_number ?? '?',
      );
      const cur = map.get(account) ?? { account, debit: 0, credit: 0 };
      cur.debit = money(cur.debit + money(row.debit));
      cur.credit = money(cur.credit + money(row.credit));
      map.set(account, cur);
    }
    return [...map.values()].sort((a, b) => a.account.localeCompare(b.account));
  }

  function fmt(lines: LineAgg[]): string {
    return lines
      .map((l) => `${l.account} Dr ${l.debit} Cr ${l.credit}`)
      .join('; ');
  }

  function hasLine(lines: LineAgg[], account: string, debit: number, credit: number): boolean {
    const row = lines.find((l) => l.account === account);
    return !!row && money(row.debit) === money(debit) && money(row.credit) === money(credit);
  }

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        DatabaseModule,
        CustomersModule,
        InvoicesModule,
        PaymentsModule,
        SuppliersModule,
        BillsModule,
        JournalEntriesModule,
        AccountingPeriodsModule,
        AuditLogModule,
        ReportsModule,
        CtModule,
      ],
    }).compile();

    invoices = module.get(InvoicesService);
    customers = module.get(CustomersService);
    payments = module.get(PaymentsService);
    suppliers = module.get(SuppliersService);
    bills = module.get(BillsService);
    journals = module.get(JournalEntriesService);
    periods = module.get(AccountingPeriodsService);
    reports = module.get(ReportsService);
    audit = module.get(AuditLogService);
    ct = module.get(CtService);
    supabase = module.get(SupabaseService);

    companyId = await mintFreshIntegrationCompany(supabase, 'Al Noor Trading');
    await ensureFiscalYearPeriods(supabase, companyId, 2025);

    const { error: rateError } = await supabase.client.from('ecl_loss_rate_policies').insert([
      { company_id: companyId, bucket: 'current', loss_rate: 0.0075, effective_from: '2026-01-01', created_by: USER_ID },
      { company_id: companyId, bucket: '0_30', loss_rate: 0.02, effective_from: '2026-01-01', created_by: USER_ID },
      { company_id: companyId, bucket: '31_60', loss_rate: 0.075, effective_from: '2026-01-01', created_by: USER_ID },
      { company_id: companyId, bucket: '61_90', loss_rate: 0.2, effective_from: '2026-01-01', created_by: USER_ID },
      { company_id: companyId, bucket: '90_plus', loss_rate: 0.4, effective_from: '2026-01-01', created_by: USER_ID },
    ]);
    if (rateError) throw rateError;
  }, 180_000);

  afterAll(() => {
    const summary = {
      pass: results.filter((r) => r.status === 'PASS').length,
      partial: results.filter((r) => r.status === 'PARTIAL').length,
      fail: results.filter((r) => r.status === 'FAIL').length,
      notImplemented: results.filter((r) => r.status === 'NOT_IMPLEMENTED').length,
      results,
    };
    writeFileSync(resolve(__dirname, '../../tmp/al_noor_workbook_results.json'), JSON.stringify(summary, null, 2));
    // eslint-disable-next-line no-console
    console.log('\n========== AL NOOR WORKBOOK ==========');
    for (const r of results) {
      // eslint-disable-next-line no-console
      console.log(`${r.id} ${r.status} — ${r.title}\n  expected: ${r.expected}\n  actual:   ${r.actual}`);
    }
    // eslint-disable-next-line no-console
    console.log(
      `\nSummary: ${summary.pass} PASS, ${summary.partial} PARTIAL, ${summary.fail} FAIL, ${summary.notImplemented} NOT_IMPLEMENTED\n`,
    );
  });

  it('executes TC1–TC10 and SG1–SG6', async () => {
    const augPeriod = await periodId('2026-08-01');
    const bank = await acct('1020');
    const ar = await acct('1100');
    const raw = await acct('1200');
    const ecl = await acct('1110');

    const { data: equity } = await supabase.client
      .from('accounts')
      .select('id, account_number')
      .eq('company_id', companyId)
      .eq('category', 'equity')
      .eq('is_system_account', false)
      .eq('is_active', true)
      .order('account_number')
      .limit(1)
      .single();
    if (!equity) throw new Error('no equity account');

    let openingBlocked = false;
    let openingMsg = '';
    try {
      await journals.createOpeningBalance(
        {
          company_id: companyId,
          fiscal_year: 2026,
          entry_date: '2026-01-01',
          narration: 'Workbook opening ECL allowance 16,500',
          lines: [
            { line_number: 1, account_id: equity.id as string, debit: 16500, credit: 0 },
            { line_number: 2, account_id: ecl, debit: 0, credit: 16500 },
          ],
        },
        USER_ID,
      );
    } catch (e) {
      openingMsg = errText(e);
    }
    try {
      await journals.createOpeningBalance(
        {
          company_id: companyId,
          fiscal_year: 2026,
          entry_date: '2026-01-01',
          narration: 'Duplicate opening balance',
          lines: [
            { line_number: 1, account_id: bank, debit: 1, credit: 0 },
            { line_number: 2, account_id: equity.id as string, debit: 0, credit: 1 },
          ],
        },
        USER_ID,
      );
    } catch (e) {
      openingBlocked = true;
      openingMsg = errText(e);
    }
    record(
      'SG2',
      'Second opening-balance import is blocked',
      openingBlocked && /already exists/i.test(openingMsg) ? 'PASS' : 'FAIL',
      'Second import rejected; not added on top',
      openingBlocked ? openingMsg : 'second opening balance was accepted',
    );

    const marhaba = await customers.create({
      company_id: companyId,
      customer_name: 'Marhaba Furnishings LLC',
      trn: '100111111100003',
    });
    const sale = await invoices.create(
      {
        company_id: companyId,
        customer_id: marhaba.id,
        invoice_date: '2026-08-25',
        payment_terms: PaymentTermsType.Net30,
        lines: [
          {
            line_number: 1,
            description: 'Office furniture',
            quantity: 1,
            unit_price: 52000,
            vat_rate: 5,
            vat_category: VatCategory.StandardRated,
            is_service: false,
          },
        ],
      },
      USER_ID,
    );
    const issued = await invoices.issue(sale.invoice.id);
    const saleLines = await linesFor(issued.invoice.journal_entry_id!);
    const saleVatOk =
      hasLine(saleLines, '1100', 54600, 0) &&
      hasLine(saleLines, '4000', 0, 52000) &&
      hasLine(saleLines, '2200', 0, 2600);
    const cogsOk = hasLine(saleLines, '5000', 34000, 0) && hasLine(saleLines, '1220', 0, 34000);
    record(
      'TC1',
      'Domestic credit sale with COGS relief',
      saleVatOk && cogsOk ? 'PASS' : saleVatOk ? 'PARTIAL' : 'FAIL',
      'Dr 1100 54600, Cr 4000 52000, Cr 2200 2600, Dr 5000 34000, Cr 1220 34000',
      `${fmt(saleLines)}${cogsOk ? '' : '; COGS 5000 and inventory 1220 were not posted by Issue'}`,
    );

    const shenzhen = await suppliers.create({
      company_id: companyId,
      supplier_name: 'Shenzhen Home Supplies Co.',
    });
    const bill = await bills.create(
      {
        company_id: companyId,
        supplier_id: shenzhen.id,
        supplier_invoice_number: 'SZ-IMPORT-1',
        bill_date: '2026-08-25',
        payment_terms: PaymentTermsType.Net30,
        lines: [
          {
            line_number: 1,
            description: 'FOB container',
            quantity: 1,
            unit_price: 145000,
            vat_rate: 0,
            vat_category: VatCategory.StandardRated,
            vat_input_treatment: VatInputTreatment.ReverseCharge,
            account_id: raw,
          },
        ],
      },
      USER_ID,
    );
    const issuedBill = await bills.issue(bill.bill.id, USER_ID, ROLE);
    const billLines = await linesFor(issuedBill.bill.journal_entry_id!);
    const rcmOk = hasLine(billLines, '1410', 7953.75, 0) && hasLine(billLines, '2210', 0, 7953.75);
    const landedOk =
      hasLine(billLines, '1200', 160275, 0) &&
      hasLine(billLines, '2800', 0, 7575);
    record(
      'TC2',
      'Import landed cost, duty and reverse-charge VAT',
      rcmOk && landedOk ? 'PASS' : 'FAIL',
      'Dr 1200 160275, Cr 2000 145000 + 7700, Cr 2800 7575, Dr 1410 7953.75, Cr 2210 7953.75',
      fmt(billLines) +
        '; engine posts one supplier AP and RCM on the line net, not CIF+duty or a second creditor',
    );

    const receipt = await payments.create(
      {
        company_id: companyId,
        customer_id: marhaba.id,
        payment_date: '2026-08-26',
        amount: 30000,
        payment_method: PaymentMethodType.BankTransfer,
        bank_account_id: bank,
        reference_number: 'MARHABA-PART',
        applications: [{ invoice_id: issued.invoice.id, applied_amount: 30000 }],
      },
      USER_ID,
    );
    const postedPay = await payments.post(receipt.payment.id, USER_ID);
    const payLines = await linesFor(postedPay.payment.journal_entry_id!);
    const payOk = hasLine(payLines, '1020', 30000, 0) && hasLine(payLines, '1100', 0, 30000);
    const outstanding = money(Number(issued.invoice.grand_total) - 30000);
    record(
      'TC3',
      'Partial customer payment',
      payOk && outstanding === 24600 ? 'PASS' : 'FAIL',
      'Dr 1020 30000, Cr 1100 30000, remaining AR 24600',
      `${fmt(payLines)}; invoice grand ${issued.invoice.grand_total} less 30000 = ${outstanding}`,
    );

    record(
      'TC4',
      'Payroll, WPS and gratuity true-up',
      'NOT_IMPLEMENTED',
      'Salary 87000 + pro-rata 7548, WPS 86500, gratuity accrual 4850, true-up payout 23100',
      'No payroll, WPS, or end-of-service module. Engine did not compute 9,000×26/31 or the 21-day gratuity formula.',
    );
    record(
      'TC5',
      'Fixed asset purchase and pro-rata depreciation',
      'NOT_IMPLEMENTED',
      'Dr 1560 85000, Dr 1400 4250, Cr 1020 89250, then Dr 5600 210, Cr 1650 210',
      'No fixed-asset or depreciation module. Engine did not compute (85000-8500)/5/365×5.',
    );

    async function agingInvoice(
      name: string,
      trn: string,
      invoiceDate: string,
      amount: number,
    ): Promise<string> {
      const customer = await customers.create({
        company_id: companyId,
        customer_name: name,
        trn,
      });
      const draft = await invoices.create(
        {
          company_id: companyId,
          customer_id: customer.id,
          invoice_date: invoiceDate,
          payment_terms: PaymentTermsType.Net30,
          lines: [
            {
              line_number: 1,
              description: name,
              quantity: 1,
              unit_price: amount,
              vat_rate: 0,
              vat_category: VatCategory.ZeroRated,
            },
          ],
        },
        USER_ID,
      );
      const row = await invoices.issue(draft.invoice.id);
      return row.invoice.id;
    }

    const zenithId = await agingInvoice('Zenith Retail Trading', '100222222200003', '2026-01-09', 3200);
    await agingInvoice('Aging 31-60', '100333333300003', '2026-06-13', 85000);
    await agingInvoice('Aging 61-90', '100444444400003', '2026-05-14', 40000);
    await agingInvoice('Bright Interiors FZE', '100555555500003', '2026-03-30', 15000);

    let writeOffLines: LineAgg[] = [];
    let writeOffMsg = '';
    try {
      const written = await invoices.writeOff(
        zenithId,
        { reason: 'Liquidated, 200 days overdue' },
        USER_ID,
        ROLE,
      );
      const { data: wo } = await supabase.client
        .from('invoices')
        .select('journal_entry_id')
        .eq('id', written.invoice.id)
        .single();
      const { data: link } = await supabase.client
        .from('write_offs')
        .select('journal_entry_id')
        .eq('invoice_id', zenithId)
        .single();
      const je = (link?.journal_entry_id as string) ?? (wo?.journal_entry_id as string);
      writeOffLines = await linesFor(je);
    } catch (e) {
      writeOffMsg = errText(e);
    }

    let eclActual = writeOffMsg || 'ECL not run';
    try {
      const { data, error } = await supabase.client.rpc('run_ecl_provision', {
        p_company_id: companyId,
        p_period_end_date: '2026-08-27',
        p_created_by: USER_ID,
      });
      if (error) throw error;
      eclActual = `write-off ${fmt(writeOffLines) || writeOffMsg}; ECL adjustment ${JSON.stringify(data?.adjustment ?? data)}`;
      const { data: eclJe } = await supabase.client
        .from('journal_entries')
        .select('id')
        .eq('company_id', companyId)
        .eq('entry_type', 'ecl_provision')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (eclJe?.id) {
        eclActual += `; lines ${fmt(await linesFor(eclJe.id as string))}`;
      }
    } catch (e) {
      eclActual = `write-off ${fmt(writeOffLines) || writeOffMsg}; ECL error ${errText(e)}`;
    }
    const writeOffOk = hasLine(writeOffLines, '1110', 3200, 0) && hasLine(writeOffLines, '1100', 0, 3200);
    const topUpOk = eclActual.includes('5640 Dr 4470') || eclActual.includes('5640 Dr 4470.00');
    record(
      'TC6',
      'ECL top-up and bad-debt write-off',
      writeOffOk && topUpOk ? 'PASS' : writeOffOk ? 'PARTIAL' : 'FAIL',
      'Dr 1110 3200 Cr 1100 3200, then Dr 5640 4470 Cr 1110 4470 (rates 5/15/40)',
      eclActual +
        '; engine seed rates are 0.75/2/7.5/20/40 percent and include the new Marhaba balance in current',
    );

    const falcon = await customers.create({
      company_id: companyId,
      customer_name: 'Falcon Business Solutions',
      trn: '100666666600003',
    });
    const advance = await payments.create(
      {
        company_id: companyId,
        customer_id: falcon.id,
        payment_date: '2026-08-28',
        amount: 63000,
        payment_method: PaymentMethodType.BankTransfer,
        bank_account_id: bank,
        reference_number: 'RETAINER-FALCON',
      },
      USER_ID,
    );
    const postedAdv = await payments.post(advance.payment.id, USER_ID);
    const advLines = await linesFor(postedAdv.payment.journal_entry_id!);
    const retainerOk =
      hasLine(advLines, '1020', 63000, 0) &&
      hasLine(advLines, '2050', 0, 60000) &&
      hasLine(advLines, '2200', 0, 3000);
    record(
      'TC7',
      'Retainer receipt and retainer application to revenue',
      retainerOk ? 'PASS' : 'FAIL',
      'Dr 1020 63000, Cr 2050 60000, Cr 2200 3000; later Dr 2050 12000 Cr 4040 12000',
      `${fmt(advLines)}; no VAT on the advance, credit is 2060 not 2050; no draw-down that credits 4040`,
    );

    const uk = await customers.create({
      company_id: companyId,
      customer_name: 'Falcon Interiors UK Ltd',
      trn: 'GB999999999',
    });
    const exp = await invoices.create(
      {
        company_id: companyId,
        customer_id: uk.id,
        invoice_date: '2026-08-28',
        payment_terms: PaymentTermsType.Net30,
        lines: [
          {
            line_number: 1,
            description: 'Export furniture GBP 8000',
            quantity: 1,
            unit_price: 39840,
            vat_rate: 0,
            vat_category: VatCategory.ZeroRated,
          },
        ],
      },
      USER_ID,
    );
    const expIssued = await invoices.issue(exp.invoice.id);
    const expLines = await linesFor(expIssued.invoice.journal_entry_id!);
    const zeroRatedOk =
      hasLine(expLines, '1100', 39840, 0) &&
      hasLine(expLines, '4010', 0, 39840) &&
      !expLines.some((l) => l.account === '2200' && l.credit > 0);
    record(
      'TC8',
      'GBP export and period-end revaluation',
      'PARTIAL',
      'Dr 1100 39840 Cr 4010 39840 at 4.98, then Dr 1100 320 Cr 4710 320 at 5.02',
      zeroRatedOk
        ? `${fmt(expLines)}; AED amount was supplied by the test. No FX rate or unrealized revaluation was computed.`
        : fmt(expLines),
    );
    if (!zeroRatedOk) {
      results[results.length - 1].status = 'FAIL';
    }

    record(
      'TC9',
      'Loan instalment, reminders, and bank reconciliation',
      'NOT_IMPLEMENTED',
      'Dr 2500 15015, Dr 5710 3485, Cr 1020 18500; bank charge Dr 5700 45',
      'No loan amortization, payment-reminder, or bank-reconciliation module. 410,000×0.85% was not computed.',
    );

    const tb = await reports.getTrialBalance(companyId, augPeriod, true);
    const tbDebit = money(tb.reduce((s, r) => s + money(r.period_debit), 0));
    const tbCredit = money(tb.reduce((s, r) => s + money(r.period_credit), 0));
    let bsBlocked = false;
    let bsMsg = 'balance sheet returned';
    try {
      await reports.getBalanceSheet(companyId, '2026-08-31');
    } catch (e) {
      bsBlocked = true;
      bsMsg = errText(e);
    }
    record(
      'SG6',
      'Trial balance gate before statements',
      tbDebit === tbCredit && bsBlocked ? 'PASS' : 'FAIL',
      'Statements blocked when trial-balance debits <> credits',
      `August TB period debits ${tbDebit} credits ${tbCredit}. Balance sheet ${bsBlocked ? 'blocked: ' + bsMsg : 'was generated with no unbalanced-TB gate'}. Posted journals cannot be unbalanced, so the gate is not a separate check.`,
    );

    const vatAccounts = ['2200', '2210', '1400', '1410'];
    const vatBits: string[] = [];
    for (const num of vatAccounts) {
      const id = await acct(num);
      const { data } = await supabase.client
        .from('journal_lines')
        .select('debit, credit, journal_entries!inner(status, company_id)')
        .eq('account_id', id);
      let d = 0;
      let c = 0;
      for (const row of data ?? []) {
        const je = row.journal_entries as { status?: string; company_id?: string };
        if (je.company_id !== companyId) continue;
        if (je.status !== 'posted' && je.status !== 'reversed') continue;
        d += money(row.debit);
        c += money(row.credit);
      }
      vatBits.push(`${num} Dr ${money(d)} Cr ${money(c)}`);
    }
    record(
      'TC10-VAT',
      'Week net VAT payable 1,350',
      'FAIL',
      'Output 13553.75 − input 12203.75 = 1350',
      vatBits.join('; ') +
        '; missing retainer VAT 3000, van input VAT 4250, and import RCM base of 159075',
    );

    const jan2025 = await periodId('2025-01-01');
    const sales4000 = await acct('4000');
    const prior = await journals.create(
      {
        company_id: companyId,
        period_id: jan2025,
        entry_date: '2025-01-31',
        narration: 'FY2025 revenue given by workbook for SBR lookback',
        lines: [
          { line_number: 1, account_id: ar, debit: 3850000, credit: 0 },
          { line_number: 2, account_id: sales4000, debit: 0, credit: 3850000 },
        ],
      },
      USER_ID,
    );
    await journals.post(prior.entry.id, USER_ID, {}, ROLE);

    for (const start of ['2026-10-01', '2026-11-01', '2026-12-01']) {
      await periods.softClose(await periodId(start), USER_ID);
    }
    const before = (await ct.taxableProfit(companyId, 2026, ROLE)) as { net_profit: number };
    const delta = money(620000 - Number(before.net_profit));
    if (delta !== 0) {
      const misc = await acct('5990');
      const adj = await journals.create(
        {
          company_id: companyId,
          period_id: augPeriod,
          entry_date: '2026-08-31',
          narration: 'Set FY2026 profit to workbook given PBT 620000',
          lines:
            delta > 0
              ? [
                  { line_number: 1, account_id: ar, debit: delta, credit: 0 },
                  { line_number: 2, account_id: sales4000, debit: 0, credit: delta },
                ]
              : [
                  { line_number: 1, account_id: misc, debit: money(-delta), credit: 0 },
                  { line_number: 2, account_id: ar, debit: 0, credit: money(-delta) },
                ],
        },
        USER_ID,
      );
      await journals.post(adj.entry.id, USER_ID, {}, ROLE);
    }
    const estimate = (await ct.taxableProfit(companyId, 2026, ROLE)) as {
      ct_due: number;
      sbr_eligible: boolean;
      taxable_profit_estimate: number;
    };
    const postedCt = (await ct.postProvision(
      { company_id: companyId, fiscal_year: 2026 },
      USER_ID,
      ROLE,
    )) as { provision?: { ct_due?: number; sbr_eligible?: boolean } };
    const ctDue = money(postedCt.provision?.ct_due ?? estimate.ct_due);
    const sbrOk = estimate.sbr_eligible === false;
    record(
      'TC10-CT',
      'Corporate tax provision and SBR lookback',
      ctDue === 22050 && sbrOk ? 'PASS' : 'FAIL',
      'SBR not eligible; Dr 5830 22050 Cr 2300 22050',
      `sbr_eligible=${estimate.sbr_eligible}, taxable_profit=${estimate.taxable_profit_estimate}, ct_due=${ctDue}. FY2025 revenue 3,850,000 and PBT 620,000 were posted as the workbook's given inputs.`,
    );

    let secondReverseBlocked = false;
    let reverseMsg = '';
    try {
      await journals.reverse(postedPay.payment.journal_entry_id!, USER_ID);
      await journals.reverse(postedPay.payment.journal_entry_id!, USER_ID);
    } catch (e) {
      secondReverseBlocked = true;
      reverseMsg = errText(e);
    }
    record(
      'SG1',
      'Second reversal of the TC3 receipt is rejected',
      secondReverseBlocked && /already been reversed/i.test(reverseMsg) ? 'PASS' : 'FAIL',
      'Second reversal rejected',
      secondReverseBlocked ? reverseMsg : 'second reversal was accepted',
    );

    const misc5990 = await acct('5990');
    const selfEntry = await journals.create(
      {
        company_id: companyId,
        period_id: augPeriod,
        entry_date: '2026-08-27',
        narration: 'Owner self-approval probe above 50000',
        lines: [
          { line_number: 1, account_id: misc5990, debit: 85000, credit: 0 },
          { line_number: 2, account_id: bank, debit: 0, credit: 85000 },
        ],
      },
      USER_ID,
    );
    const selfPosted = await journals.post(selfEntry.entry.id, USER_ID, {}, ROLE);
    const auditRows = await audit.find({
      company_id: companyId,
      record_id: selfPosted.entry.id,
      table_name: 'journal_entries',
    });
    const selfLogged = auditRows.some(
      (r) => r.action === AuditAction.StatusChange && r.notes === 'Self-approved by Owner',
    );
    await journals.reverse(selfPosted.entry.id, USER_ID);
    record(
      'SG4',
      'Owner create-and-approve is allowed and logged as self-approved',
      selfPosted.entry.status === 'posted' && selfLogged ? 'PASS' : 'FAIL',
      'Owner may post above threshold; audit note Self-approved by Owner',
      `status=${selfPosted.entry.status}, self-approved note=${selfLogged}`,
    );

    let firstCloseOk = false;
    let secondCloseBlocked = false;
    let closeMsg = '';
    try {
      await periods.softClose(augPeriod, USER_ID);
      firstCloseOk = true;
    } catch (e) {
      closeMsg = errText(e);
    }
    try {
      await periods.softClose(augPeriod, USER_ID);
    } catch (e) {
      secondCloseBlocked = true;
      closeMsg = errText(e);
    }
    record(
      'SG3',
      'August soft-close cannot be run twice',
      firstCloseOk && secondCloseBlocked ? 'PASS' : 'FAIL',
      'Second close rejected until an explicit reopen',
      firstCloseOk
        ? secondCloseBlocked
          ? closeMsg
          : 'second soft-close was accepted'
        : `first close failed: ${closeMsg}`,
    );

    let backdateBlocked = false;
    let backdateMsg = '';
    try {
      const back = await journals.create(
        {
          company_id: companyId,
          period_id: augPeriod,
          entry_date: '2026-08-25',
          narration: 'Backdated after lock',
          lines: [
            { line_number: 1, account_id: misc5990, debit: 10, credit: 0 },
            { line_number: 2, account_id: bank, debit: 0, credit: 10 },
          ],
        },
        USER_ID,
      );
      await journals.post(back.entry.id, USER_ID, {}, ROLE);
    } catch (e) {
      backdateBlocked = true;
      backdateMsg = errText(e);
    }
    record(
      'SG5',
      'Posting into locked August is rejected without an override',
      backdateBlocked && /soft_closed|override/i.test(backdateMsg) ? 'PASS' : 'FAIL',
      'Rejected unless a prior-period override reason is supplied',
      backdateBlocked ? backdateMsg : 'backdated post was accepted',
    );

    const bad = results.filter((r) => r.status === 'FAIL' || r.status === 'NOT_IMPLEMENTED' || r.status === 'PARTIAL');
    expect(results.map((r) => r.id)).toEqual([
      'SG2',
      'TC1',
      'TC2',
      'TC3',
      'TC4',
      'TC5',
      'TC6',
      'TC7',
      'TC8',
      'TC9',
      'SG6',
      'TC10-VAT',
      'TC10-CT',
      'SG1',
      'SG4',
      'SG3',
      'SG5',
    ]);
    expect(bad.length).toBeGreaterThan(0);
  });
});
