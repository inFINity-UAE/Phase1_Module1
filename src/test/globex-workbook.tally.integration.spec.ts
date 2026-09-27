import { config } from 'dotenv';
import { resolve } from 'path';
import { writeFileSync } from 'fs';

config({ path: resolve(__dirname, '../../.env.local') });

import { Test, TestingModule } from '@nestjs/testing';
import { readFileSync } from 'fs';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { CustomersModule } from '../customers/customers.module';
import { CustomersService } from '../customers/customers.service';
import { InvoicesModule } from '../invoices/invoices.module';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentsService } from '../payments/payments.service';
import { ReportsModule } from '../reports/reports.module';
import { ReportsService } from '../reports/reports.service';
import { PaymentTermsType } from '../invoices/common/enums/payment-terms-type.enum';
import { PaymentMethodType } from '../payments/common/enums/payment-method-type.enum';
import { VatCategory } from '../common/enums/vat-category.enum';
import { getAccountIdByNumber, ensureFiscalYearPeriods } from '../e2e/e2e-company.setup';
import {
  INTEGRATION_USER_ID,
  mintFreshIntegrationCompany,
} from './integration-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);
const runGlobex = hasSupabase && process.env.GLOBEX_TALLY === '1';

const DUMP_PATH = resolve(__dirname, '../../tmp/globex_dump.json');
const REPORT_PATH = resolve(__dirname, '../../tmp/globex_tally_report.json');
const USER_ID = INTEGRATION_USER_ID;

/**
 * Test-only ADCB slot. Seed 1021 is a 1020 child (hierarchy demo), not a second
 * bank; do not add ADCB to the production COA. Unused 1030 Savings is the
 * stand-in for this company only.
 */
const GLOBEX_ADCB_ACCOUNT_NUMBER = '1030';

type LedgerRow = {
  Date?: string;
  Bank?: string;
  Reference?: string;
  Description?: string;
  'Money In (AED)'?: number;
  'Money Out (AED)'?: number;
  'Statement Balance (AED)'?: number;
  'Transaction Type'?: string;
  Category?: string;
  Customer?: string;
  'Invoice No.'?: string;
  'Review Notes'?: string;
};

type InvoiceRow = {
  'Invoice No.'?: string;
  'Issue Date'?: string;
  'Due Date'?: string | number;
  Customer?: string;
  Description?: string;
  Currency?: string;
  'Invoice Amount'?: number;
  Status?: string;
  'Payments Consolidated'?: number;
  Outstanding?: number;
  'Payment Date / Reference'?: string;
  Notes?: string;
};

type Dump = {
  ledger: LedgerRow[];
  invoices: InvoiceRow[];
  monthly_summary: unknown[][];
  dashboard: unknown[][];
  internal_transfers: unknown[][];
  totals: {
    in: number;
    out: number;
    net: number;
    by_category: Record<string, { in: number; out: number; n: number }>;
    by_bank: Record<string, { in: number; out: number; n: number }>;
  };
};

type TransferPair = {
  wioRef: string;
  wioAmountOut: number;
  adcbRef: string;
  adcbAmountIn: number;
  matchStatus: string;
};

type Check = {
  area: string;
  ok: boolean;
  expected: number | string | null;
  actual: number | string | null;
  delta?: number;
  note?: string;
};

function money(n: unknown): number {
  return Math.round(Number(n ?? 0) * 100) / 100;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function monthEnd(periodStart: string): string {
  const [y, m] = periodStart.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
}

function accountBalance(
  rows: Array<{ account_number: string; balance: number }>,
  accountNumber: string,
): number {
  const row = rows.find((r) => r.account_number === accountNumber);
  return money(row?.balance ?? 0);
}

/**
 * Workbook Category → existing seed COA (demo company 0002).
 * Review* stays on 1910 because the workbook itself did not classify them.
 * [Assumption] VAT-silent invoices use out_of_scope + 4040 Service Revenue.
 */
const CATEGORY_ACCOUNT: Record<string, string> = {
  'Business Income': '4040',
  'Salary Expense': '5100',
  'Bank Charges': '5700',
  'Bank / FX Charges': '5700',
  'Software / IT': '5530',
  Telecommunications: '5560',
  'Review - Shahram Funding/Income': '1910',
  'Review - Director/Personal Transfer': '1910',
  'Review - Cash Deposit': '1910',
  'Review - Crypto / Investment': '1910',
  'Review - Payment': '1910',
  'Review Required': '1910',
};

function parseTransferPairs(rows: unknown[][]): TransferPair[] {
  const pairs: TransferPair[] = [];
  for (const raw of rows.slice(1)) {
    if (!raw?.length) continue;
    const wioRef = raw[2] == null || raw[2] === '' ? '' : String(raw[2]);
    const adcbRef = raw[5] == null || raw[5] === '' ? '' : String(raw[5]);
    const matchStatus = String(raw[7] ?? '').trim();
    if (!wioRef && !adcbRef) continue;
    pairs.push({
      wioRef,
      wioAmountOut: money(raw[1]),
      adcbRef,
      adcbAmountIn: money(raw[4]),
      matchStatus,
    });
  }
  return pairs;
}

(runGlobex ? describe : describe.skip)(
  'Globex workbook vs engine tally (cashbook + invoice register)',
  () => {
    jest.setTimeout(1_800_000);

    it(
      'posts Combined Ledger + Invoice Register and lists mismatches',
      async () => {
      const dump = JSON.parse(readFileSync(DUMP_PATH, 'utf8')) as Dump;
      const checks: Check[] = [];
      const postErrors: Array<{ where: string; error: string }> = [];

      const add = (
        area: string,
        expected: number,
        actual: number,
        note?: string,
      ) => {
        const exp = money(expected);
        const act = money(actual);
        checks.push({
          area,
          ok: Math.round((exp - act) * 100) === 0,
          expected: exp,
          actual: act,
          delta: round2(act - exp),
          note,
        });
      };

      const module: TestingModule = await Test.createTestingModule({
        imports: [
          DatabaseModule,
          JournalEntriesModule,
          CustomersModule,
          InvoicesModule,
          PaymentsModule,
          ReportsModule,
        ],
      }).compile();

      const supabase = module.get(SupabaseService);
      const journalService = module.get(JournalEntriesService);
      const customersService = module.get(CustomersService);
      const invoicesService = module.get(InvoicesService);
      const paymentsService = module.get(PaymentsService);
      const reportsService = module.get(ReportsService);

      // ── Company A: cash-classified Combined Ledger ──────────────────────
      const cashCompanyId = await mintFreshIntegrationCompany(
        supabase,
        'Globex Cashbook',
        { fiscalYear: 2024 },
      );
      await ensureFiscalYearPeriods(supabase, cashCompanyId, 2025);

      const cashAccounts: Record<string, string> = {};
      for (const num of [
        '1020',
        GLOBEX_ADCB_ACCOUNT_NUMBER,
        '1910',
        '4040',
        '5100',
        '5530',
        '5560',
        '5700',
      ]) {
        cashAccounts[num] = await getAccountIdByNumber(supabase, cashCompanyId, num);
      }

      const { data: cashPeriods, error: cashPeriodErr } = await supabase.client
        .from('accounting_periods')
        .select('id, period_start')
        .eq('company_id', cashCompanyId);
      if (cashPeriodErr) throw cashPeriodErr;
      const cashPeriodByStart = new Map(
        (cashPeriods ?? []).map((p) => [p.period_start as string, p.id as string]),
      );

      const transferPairs = parseTransferPairs(dump.internal_transfers ?? []);
      const wioPairByRef = new Map(
        transferPairs.filter((p) => p.wioRef).map((p) => [p.wioRef, p]),
      );
      const adcbPairByRef = new Map(
        transferPairs.filter((p) => p.adcbRef).map((p) => [p.adcbRef, p]),
      );

      let posted = 0;
      let skippedMatchedAdcbXfer = 0;
      for (const [idx, row] of dump.ledger.entries()) {
        const date = row.Date;
        if (!isIsoDate(date)) {
          postErrors.push({
            where: `cash row ${idx}`,
            error: `bad date ${String(date)}`,
          });
          continue;
        }
        const periodStart = `${date.slice(0, 7)}-01`;
        const periodId = cashPeriodByStart.get(periodStart);
        if (!periodId) {
          postErrors.push({
            where: `cash row ${idx} ${date}`,
            error: `no period ${periodStart}`,
          });
          continue;
        }

        const moneyIn = money(row['Money In (AED)']);
        const moneyOut = money(row['Money Out (AED)']);
        if (moneyIn === 0 && moneyOut === 0) continue;
        if (moneyIn > 0 && moneyOut > 0) {
          postErrors.push({
            where: `cash row ${idx} ${date}`,
            error: `both in ${moneyIn} and out ${moneyOut}`,
          });
          continue;
        }

        const bankName = String(row.Bank ?? '').trim();
        const bankAcct =
          bankName === 'Wio'
            ? '1020'
            : bankName === 'ADCB'
              ? GLOBEX_ADCB_ACCOUNT_NUMBER
              : null;
        if (!bankAcct) {
          postErrors.push({
            where: `cash row ${idx} ${date}`,
            error: `unknown bank ${bankName}`,
          });
          continue;
        }

        const category = String(row.Category ?? '').trim();
        const amount = moneyIn > 0 ? moneyIn : moneyOut;
        const isIn = moneyIn > 0;
        let counter = CATEGORY_ACCOUNT[category];

        if (category === 'Internal Transfer') {
          const ref = String(row.Reference ?? '').trim();
          if (bankName === 'Wio') {
            const pair = wioPairByRef.get(ref);
            if (pair?.matchStatus === 'Matched') {
              counter = GLOBEX_ADCB_ACCOUNT_NUMBER;
            } else {
              postErrors.push({
                where: `cash row ${idx} ${date} Internal Transfer Wio ${ref}`,
                error: pair
                  ? `unmatched Internal Transfers sheet row (Match Status=${pair.matchStatus}, Wio ${pair.wioAmountOut} vs ADCB ${pair.adcbAmountIn})`
                  : 'Wio internal-transfer ref not on Internal Transfers sheet (no ADCB counterpart)',
              });
              counter = '1910';
            }
          } else {
            const pair = adcbPairByRef.get(ref);
            if (pair?.matchStatus === 'Matched') {
              skippedMatchedAdcbXfer += 1;
              continue;
            }
            postErrors.push({
              where: `cash row ${idx} ${date} Internal Transfer ADCB ${ref}`,
              error: pair
                ? `unmatched Internal Transfers sheet row (Match Status=${pair.matchStatus})`
                : 'ADCB internal-transfer ref not on Internal Transfers sheet (no Wio counterpart)',
            });
            counter = '1910';
          }
        }

        if (!counter) {
          postErrors.push({
            where: `cash row ${idx} ${date}`,
            error: `unmapped category ${category}`,
          });
          continue;
        }

        const bankId = cashAccounts[bankAcct];
        const otherId = cashAccounts[counter];
        const lines = isIn
          ? [
              { line_number: 1, account_id: bankId, debit: amount, credit: 0 },
              { line_number: 2, account_id: otherId, debit: 0, credit: amount },
            ]
          : [
              { line_number: 1, account_id: otherId, debit: amount, credit: 0 },
              { line_number: 2, account_id: bankId, debit: 0, credit: amount },
            ];

        try {
          const draft = await journalService.create(
            {
              company_id: cashCompanyId,
              period_id: periodId,
              entry_date: date,
              narration: String(row.Description ?? category).slice(0, 200),
              reference_number: row.Reference ? String(row.Reference).slice(0, 80) : undefined,
              lines,
            },
            USER_ID,
          );
          await journalService.post(draft.entry.id, USER_ID);
          posted += 1;
        } catch (e) {
          postErrors.push({
            where: `cash row ${idx} ${date} ${category} ${amount}`,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      const cashPnl = await reportsService.getProfitAndLoss(
        cashCompanyId,
        '2024-09-01',
        '2025-12-31',
      );
      const cashBs = await reportsService.getBalanceSheet(cashCompanyId, '2025-12-31');
      const cashWio = accountBalance(cashBs.accounts, '1020');
      const cashAdcb = accountBalance(cashBs.accounts, GLOBEX_ADCB_ACCOUNT_NUMBER);
      const cashSuspense = accountBalance(cashBs.accounts, '1910');
      const cashSales = accountBalance(cashPnl.accounts, '4040');
      const cashSalary = accountBalance(cashPnl.accounts, '5100');
      const cashBankChg = accountBalance(cashPnl.accounts, '5700');
      const cashSoftware = accountBalance(cashPnl.accounts, '5530');
      const cashTelecom = accountBalance(cashPnl.accounts, '5560');

      const wioNet = round2(dump.totals.by_bank.Wio.in - dump.totals.by_bank.Wio.out);
      const adcbNet = round2(dump.totals.by_bank.ADCB.in - dump.totals.by_bank.ADCB.out);
      const cats = dump.totals.by_category;
      const businessIncome = cats['Business Income']?.in ?? 0;
      const salaryOut = cats['Salary Expense']?.out ?? 0;
      const bankChgOut = round2(
        (cats['Bank Charges']?.out ?? 0) + (cats['Bank / FX Charges']?.out ?? 0),
      );
      const softwareNet = round2(
        (cats['Software / IT']?.out ?? 0) - (cats['Software / IT']?.in ?? 0),
      );
      const telecomOut = cats.Telecommunications?.out ?? 0;
      const reviewIn = round2(
        (cats['Review - Shahram Funding/Income']?.in ?? 0) +
          (cats['Review - Cash Deposit']?.in ?? 0),
      );
      const reviewOut = round2(
        (cats['Review - Director/Personal Transfer']?.out ?? 0) +
          (cats['Review - Crypto / Investment']?.out ?? 0) +
          (cats['Review - Payment']?.out ?? 0) +
          (cats['Review Required']?.out ?? 0),
      );
      const reviewNetParked = round2(reviewOut - reviewIn);

      add('cash 1020 Wio vs statement net', wioNet, cashWio, 'Wio posted to 1020');
      add(
        `cash ${GLOBEX_ADCB_ACCOUNT_NUMBER} ADCB vs statement net`,
        adcbNet,
        cashAdcb,
        `ADCB posted to test-only ${GLOBEX_ADCB_ACCOUNT_NUMBER}; matched Wio→ADCB pairs only (Internal Transfers sheet)`,
      );
      add(
        `cash 1020+${GLOBEX_ADCB_ACCOUNT_NUMBER} vs workbook net cash 983.80`,
        dump.totals.net,
        round2(cashWio + cashAdcb),
      );
      add('cash P&L 4040 vs Combined Business Income', businessIncome, cashSales);
      add('cash P&L 5100 vs Combined Salary Expense', salaryOut, cashSalary);
      add('cash P&L 5700 vs Combined Bank+FX charges', bankChgOut, cashBankChg);
      add('cash P&L 5530 vs Combined Software/IT net', softwareNet, cashSoftware);
      add('cash P&L 5560 vs Combined Telecommunications', telecomOut, cashTelecom);
      add(
        'cash 1910 suspense vs Review out−in',
        reviewNetParked,
        cashSuspense,
        'Review categories parked on 1910 (workbook did not classify them as P&L)',
      );
      add('cash P&L vs Dashboard salary 385000', 385000, cashSalary);
      add(
        'cash P&L 4040 vs Dashboard invoices issued 213685.61',
        213685.61,
        cashSales,
        'Workbook income rule is Wio client receipts, not the invoice register',
      );

      const monthlyChecks: Check[] = [];
      const msHeader = dump.monthly_summary[0] as string[];
      for (const raw of dump.monthly_summary.slice(1)) {
        const row = raw as unknown[];
        if (!isIsoDate(row[0])) continue;
        const start = String(row[0]).slice(0, 10);
        const end = monthEnd(start);
        const wbIncome = money(row[msHeader.indexOf('Business Income')]);
        const wbSalary = money(row[msHeader.indexOf('Salary Expense')]);
        const wbBank = money(row[msHeader.indexOf('Bank/FX Charges')]);
        const wbSoft = money(row[msHeader.indexOf('Software/IT')]);
        const wbTel = money(row[msHeader.indexOf('Telecoms')]);
        const wbNet = money(row[msHeader.indexOf('Net Cash Movement')]);
        const pnl = await reportsService.getProfitAndLoss(cashCompanyId, start, end);
        const bsEnd = await reportsService.getBalanceSheet(cashCompanyId, end);
        const bsStart = await reportsService.getBalanceSheet(
          cashCompanyId,
          start === '2024-09-01' ? '2024-08-31' : monthEnd(priorMonthStart(start)),
        );
        const cashEnd = round2(
          accountBalance(bsEnd.accounts, '1020') +
            accountBalance(bsEnd.accounts, GLOBEX_ADCB_ACCOUNT_NUMBER),
        );
        const cashStart = round2(
          accountBalance(bsStart.accounts, '1020') +
            accountBalance(bsStart.accounts, GLOBEX_ADCB_ACCOUNT_NUMBER),
        );
        const engineNet = round2(cashEnd - cashStart);
        const pair: Array<[string, number, number]> = [
          [`${start} Business Income vs 4040`, wbIncome, accountBalance(pnl.accounts, '4040')],
          [`${start} Salary vs 5100`, wbSalary, accountBalance(pnl.accounts, '5100')],
          [`${start} Bank/FX vs 5700`, wbBank, accountBalance(pnl.accounts, '5700')],
          [`${start} Software/IT vs 5530`, wbSoft, accountBalance(pnl.accounts, '5530')],
          [`${start} Telecoms vs 5560`, wbTel, accountBalance(pnl.accounts, '5560')],
          [
            `${start} Net cash vs 1020+${GLOBEX_ADCB_ACCOUNT_NUMBER} change`,
            wbNet,
            engineNet,
          ],
        ];
        for (const [area, expected, actual] of pair) {
          const ok = Math.round((expected - actual) * 100) === 0;
          monthlyChecks.push({
            area,
            ok,
            expected,
            actual,
            delta: round2(actual - expected),
          });
        }
      }

      // ── Company B: Invoice Register (accrual) + full receipts ───────────
      const invCompanyId = await mintFreshIntegrationCompany(
        supabase,
        'Globex Invoices',
        { fiscalYear: 2024 },
      );
      await ensureFiscalYearPeriods(supabase, invCompanyId, 2025);
      const income4040 = await getAccountIdByNumber(supabase, invCompanyId, '4040');
      const bank1020Inv = await getAccountIdByNumber(supabase, invCompanyId, '1020');

      const customerIds = new Map<string, string>();
      const issued: Array<{
        workbookNo: string;
        customer: string;
        workbookAmount: number;
        engineGrand: number;
        engineVat: number;
        engineNumber: string | null;
        engineDue: string | null;
        workbookDue: string | null;
        amountPaid: number;
        outstanding: number;
        paymentError?: string;
      }> = [];

      for (const inv of dump.invoices) {
        const name = String(inv.Customer ?? '').trim();
        const issueDate = inv['Issue Date'];
        if (!name || !isIsoDate(issueDate)) {
          postErrors.push({
            where: `invoice ${inv['Invoice No.']}`,
            error: `bad customer/date ${name} ${String(issueDate)}`,
          });
          continue;
        }
        if (!customerIds.has(name)) {
          const created = await customersService.create({
            company_id: invCompanyId,
            customer_name: name,
          });
          customerIds.set(name, created.id);
        }
        const amount = money(inv['Invoice Amount']);
        try {
          const draft = await invoicesService.create(
            {
              company_id: invCompanyId,
              customer_id: customerIds.get(name)!,
              invoice_date: issueDate,
              payment_terms: PaymentTermsType.Net30,
              lines: [
                {
                  line_number: 1,
                  description: String(inv.Description ?? inv['Invoice No.']),
                  quantity: 1,
                  unit_price: amount,
                  vat_rate: 0,
                  vat_category: VatCategory.OutOfScope,
                  is_service: true,
                  income_account_id: income4040,
                },
              ],
            },
            USER_ID,
          );
          const issuedInv = await invoicesService.issue(draft.invoice.id);
          const grand = money(issuedInv.invoice.grand_total);
          const payRaw = inv['Payment Date / Reference'];
          const payDate = isIsoDate(payRaw) ? payRaw : issueDate;
          let paymentError: string | undefined;
          try {
            const payment = await paymentsService.create(
              {
                company_id: invCompanyId,
                customer_id: customerIds.get(name)!,
                payment_date: payDate,
                amount: grand,
                payment_method: PaymentMethodType.BankTransfer,
                bank_account_id: bank1020Inv,
                reference_number: inv['Invoice No.'] ? String(inv['Invoice No.']) : undefined,
                applications: [{ invoice_id: issuedInv.invoice.id, applied_amount: grand }],
              },
              USER_ID,
            );
            await paymentsService.post(payment.payment.id, USER_ID);
          } catch (e) {
            paymentError = e instanceof Error ? e.message : String(e);
            postErrors.push({
              where: `payment ${inv['Invoice No.']}`,
              error: paymentError,
            });
          }
          const reloaded = await invoicesService.findOne(issuedInv.invoice.id);
          issued.push({
            workbookNo: String(inv['Invoice No.']),
            customer: name,
            workbookAmount: amount,
            engineGrand: money(reloaded.invoice.grand_total),
            engineVat: money(reloaded.invoice.vat_total),
            engineNumber: reloaded.invoice.invoice_number,
            engineDue: reloaded.invoice.due_date,
            workbookDue: isIsoDate(inv['Due Date']) ? inv['Due Date'] : null,
            amountPaid: money(reloaded.invoice.amount_paid),
            outstanding: round2(
              money(reloaded.invoice.grand_total) - money(reloaded.invoice.amount_paid),
            ),
            paymentError,
          });
        } catch (e) {
          postErrors.push({
            where: `invoice ${inv['Invoice No.']}`,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      const invPnl = await reportsService.getProfitAndLoss(
        invCompanyId,
        '2024-09-01',
        '2025-12-31',
      );
      const invSales = accountBalance(invPnl.accounts, '4040');
      const salesByCustomer = await reportsService.getSalesByCustomer(
        invCompanyId,
        '2024-09-01',
        '2025-12-31',
      );
      const aged = await reportsService.getAgedReceivables(invCompanyId, '2025-12-31');
      const agedTotal = money(aged.find((r) => r.is_totals)?.total ?? 0);
      const invIssuedSum = round2(issued.reduce((s, r) => s + r.engineGrand, 0));
      const invPaidCount = issued.filter((r) => r.outstanding === 0).length;
      const invOutstandingSum = round2(issued.reduce((s, r) => s + r.outstanding, 0));
      const invVatSum = round2(issued.reduce((s, r) => s + r.engineVat, 0));

      add('invoice P&L 4040 vs Dashboard invoices issued', 213685.61, invSales);
      add('invoice grand_total sum vs Dashboard 213685.61', 213685.61, invIssuedSum);
      add('invoices issued count vs Dashboard 14', 14, issued.length);
      add('invoices fully paid count vs Dashboard 14', 14, invPaidCount);
      add('invoice outstanding vs Dashboard 0', 0, invOutstandingSum);
      add('aged AR totals vs Dashboard outstanding 0', 0, agedTotal);
      add('invoice VAT total vs workbook (no VAT shown)', 0, invVatSum);
      add(
        'H2 sales-by-customer sum vs Dashboard 213685.61',
        213685.61,
        round2(salesByCustomer.reduce((s, r) => s + money(r.total_revenue), 0)),
      );

      const byCustomerWb = new Map<string, number>();
      for (const inv of dump.invoices) {
        const name = String(inv.Customer ?? '').trim();
        byCustomerWb.set(name, round2((byCustomerWb.get(name) ?? 0) + money(inv['Invoice Amount'])));
      }
      const idToName = new Map([...customerIds.entries()].map(([n, id]) => [id, n]));
      for (const [name, wbAmt] of byCustomerWb) {
        const cid = customerIds.get(name);
        const row = salesByCustomer.find((r) => r.customer_id === cid);
        add(`sales-by-customer ${name}`, wbAmt, money(row?.total_revenue ?? 0));
      }

      const dueMismatches = issued.filter(
        (r) => r.workbookDue && r.engineDue && r.workbookDue !== r.engineDue,
      );

      const expense2025 = await reportsService.getExpenseAnalysis(cashCompanyId, 2025);
      const payroll2025 = round2(
        expense2025
          .filter((r) => r.sub_category === 'Payroll')
          .reduce((s, r) => s + money(r.amount), 0),
      );
      add(
        'H2 expense analysis 2025 Payroll vs 11×35000 (no Dec salary)',
        385000,
        payroll2025,
        'Workbook salary is 11 months × 35,000 in 2025 (none in 2024 / Dec 2025)',
      );

      const errorAreas = [
        ...checks.filter((c) => !c.ok),
        ...monthlyChecks.filter((c) => !c.ok),
      ];

      const report = {
        generated_at: new Date().toISOString(),
        cash_company_id: cashCompanyId,
        invoice_company_id: invCompanyId,
        posted_cash_jes: posted,
        skipped_matched_adcb_internal_transfers: skippedMatchedAdcbXfer,
        post_errors: postErrors,
        assumptions: [
          'Two companies: A = Combined Ledger cash JEs; B = Invoice Register + receipts. Same-company would double-count sales.',
          'VAT: workbook silent → vat_rate 0 / vat_category out_of_scope / income 4040 (Assumption).',
          `Wio → 1020, ADCB → test-only ${GLOBEX_ADCB_ACCOUNT_NUMBER} (seed Savings stand-in). Internal transfers posted from the Wio side only when Internal Transfers sheet Match Status=Matched; unmatched/missing-pair legs postError and park on 1910.`,
          'Review* parked on 1910 Suspense Assets — workbook Category is Review, not P&L.',
          'Software/IT refunds credit 5530. Bank Charges + Bank/FX Charges both 5700.',
          'Invoice due dates use engine Net30, not the workbook Due Date column.',
          'Two invoices have no payment date (“Paid in full - date not separately identified”) — used issue date.',
          'Module B (OCR/bank ingest) is queued; this run is manual posting of workbook numbers.',
        ],
        cash_balances: {
          wio_1020: cashWio,
          adcb_test_bank: cashAdcb,
          adcb_test_bank_account: GLOBEX_ADCB_ACCOUNT_NUMBER,
          suspense_1910: cashSuspense,
          pnl: {
            income: cashPnl.total_income,
            expense: cashPnl.total_expense,
            net_profit: cashPnl.net_profit,
            sales_4040: cashSales,
            salary_5100: cashSalary,
            bank_5700: cashBankChg,
            software_5530: cashSoftware,
            telecom_5560: cashTelecom,
          },
          bs_balanced: cashBs.is_balanced,
        },
        invoices: issued,
        due_date_mismatches: dueMismatches,
        sales_by_customer: salesByCustomer.map((r) => ({
          customer: idToName.get(r.customer_id) ?? r.customer_id,
          total_revenue: money(r.total_revenue),
          invoice_count: r.invoice_count,
        })),
        checks,
        monthly_checks: monthlyChecks,
        error_areas: errorAreas,
      };

      writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            cashCompanyId,
            invCompanyId,
            posted,
            skippedMatchedAdcbXfer,
            postErrorCount: postErrors.length,
            checkFails: checks.filter((c) => !c.ok).length,
            monthlyFails: monthlyChecks.filter((c) => !c.ok).length,
            errorAreas: errorAreas.map((c) => ({
              area: c.area,
              expected: c.expected,
              actual: c.actual,
              delta: c.delta,
              note: c.note,
            })),
            postErrors,
          },
          null,
          2,
        ),
      );

      expect(checks.filter((c) => !c.ok)).toEqual([]);
      expect(monthlyChecks.filter((c) => !c.ok)).toEqual([]);
      expect(postErrors.filter((e) => !e.error.includes('unmapped'))).toEqual([]);
    },
      1_800_000,
    );
  },
);

function priorMonthStart(periodStart: string): string {
  const [y, m] = periodStart.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 10);
}
