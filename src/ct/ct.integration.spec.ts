import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { CustomersModule } from '../customers/customers.module';
import { CustomersService } from '../customers/customers.service';
import { CompanyRole } from '../common/enums/company-role.enum';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { RelatedPartyRelationship } from '../common/enums/related-party-relationship.enum';
import { InvoicesModule } from '../invoices/invoices.module';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentTermsType } from '../invoices/common/enums/payment-terms-type.enum';
import { INTEGRATION_USER_ID, mintFreshIntegrationCompany } from '../test/integration-company.setup';
import { ensureFiscalYearPeriods, getAccountIdByNumber } from '../e2e/e2e-company.setup';
import { CtModule } from './ct.module';
import { CtService } from './ct.service';
import { CtController } from './ct.controller';
import { CtRepository, CT_REPOSITORY } from './ct.repository';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

async function postIncome(
  journal: JournalEntriesService,
  companyId: string,
  periodId: string,
  cashId: string,
  incomeId: string,
  amount: number,
  date: string,
  narration: string,
) {
  const draft = await journal.create(
    {
      company_id: companyId,
      period_id: periodId,
      entry_date: date,
      narration,
      lines: [
        { line_number: 1, account_id: cashId, debit: amount, credit: 0 },
        { line_number: 2, account_id: incomeId, debit: 0, credit: amount },
      ],
    },
    INTEGRATION_USER_ID,
  );
  await journal.post(draft.entry.id, INTEGRATION_USER_ID);
}

async function postExpense(
  journal: JournalEntriesService,
  companyId: string,
  periodId: string,
  cashId: string,
  expenseId: string,
  amount: number,
  date: string,
  narration: string,
) {
  const draft = await journal.create(
    {
      company_id: companyId,
      period_id: periodId,
      entry_date: date,
      narration,
      lines: [
        { line_number: 1, account_id: expenseId, debit: amount, credit: 0 },
        { line_number: 2, account_id: cashId, debit: 0, credit: amount },
      ],
    },
    INTEGRATION_USER_ID,
  );
  await journal.post(draft.entry.id, INTEGRATION_USER_ID);
}

(hasSupabase ? describe : describe.skip)('Module G UAE CT (feature-spec-1_1_G.md)', () => {
  jest.setTimeout(180_000);

  let journal: JournalEntriesService;
  let ct: CtService;
  let repo: CtRepository;
  let supabase: SupabaseService;
  let invoices: InvoicesService;
  let customers: CustomersService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        DatabaseModule,
        AccountingPeriodsModule,
        JournalEntriesModule,
        CustomersModule,
        InvoicesModule,
        CtModule,
      ],
    }).compile();
    journal = module.get(JournalEntriesService);
    ct = module.get(CtService);
    repo = module.get(CT_REPOSITORY);
    supabase = module.get(SupabaseService);
    invoices = module.get(InvoicesService);
    customers = module.get(CustomersService);
  }, 120000);

  it('create_ct_provision_entry posts Dr 5830 Cr 2300 and blocks a second call', async () => {
    const companyId = await mintFreshIntegrationCompany(supabase, 'CT provision');
    const periods = await ensureFiscalYearPeriods(supabase, companyId, 2026);
    const jan = periods.get('2026-01-01')!;
    const cash = await getAccountIdByNumber(supabase, companyId, '1020');
    const income = await getAccountIdByNumber(supabase, companyId, '4000');
    await postIncome(journal, companyId, jan, cash, income, 500_000, '2026-01-15', 'CT income');

    const posted = (await ct.postProvision(
      { company_id: companyId, fiscal_year: 2026 },
      INTEGRATION_USER_ID,
      CompanyRole.Owner,
    )) as {
      provision: {
        ct_due: string | number;
        status: string;
        provision_journal_entry_id: string;
        posted_by: string;
      };
      entry: { entry_type: string; id: string };
    };

    expect(posted.provision.status).toBe('posted');
    expect(Number(posted.provision.ct_due)).toBe(11250);
    expect(posted.entry.entry_type).toBe(JournalEntryType.CtProvision);
    expect(posted.provision.posted_by).toBe(INTEGRATION_USER_ID);

    const { data: lines, error } = await supabase.client
      .from('journal_lines')
      .select('account_id, debit, credit')
      .eq('journal_entry_id', posted.entry.id)
      .order('line_number');
    if (error) throw error;
    const exp = await getAccountIdByNumber(supabase, companyId, '5830');
    const pay = await getAccountIdByNumber(supabase, companyId, '2300');
    expect(Number(lines![0].debit)).toBe(11250);
    expect(Number(lines![0].credit)).toBe(0);
    expect(lines![0].account_id).toBe(exp);
    expect(Number(lines![1].debit)).toBe(0);
    expect(Number(lines![1].credit)).toBe(11250);
    expect(lines![1].account_id).toBe(pay);

    await expect(
      ct.postProvision(
        { company_id: companyId, fiscal_year: 2026 },
        INTEGRATION_USER_ID,
        CompanyRole.Owner,
      ),
    ).rejects.toThrow(/CT_PROVISION_ALREADY_POSTED/);
  });

  it('year-end raises CT_PROVISION_NOT_POSTED, skip+reason works, then succeeds after provision', async () => {
    const companyId = await mintFreshIntegrationCompany(supabase, 'CT YE gate');
    const periods = await ensureFiscalYearPeriods(supabase, companyId, 2026);
    const jan = periods.get('2026-01-01')!;
    const cash = await getAccountIdByNumber(supabase, companyId, '1020');
    const income = await getAccountIdByNumber(supabase, companyId, '4000');
    await postIncome(journal, companyId, jan, cash, income, 400_000, '2026-01-15', 'YE P&L');

    await expect(
      journal.runYearEndClosing({ company_id: companyId, fiscal_year: 2026 }, INTEGRATION_USER_ID),
    ).rejects.toThrow(/No posted CT provision exists/);

    const skipped = await journal.runYearEndClosing(
      {
        company_id: companyId,
        fiscal_year: 2026,
        skip_ct_check: true,
        skip_reason: 'owner skip for G-22 test',
      },
      INTEGRATION_USER_ID,
      CompanyRole.Owner,
    );
    expect(skipped.entry.narration).toMatch(/CT skip: owner skip for G-22 test/);

    const companyB = await mintFreshIntegrationCompany(supabase, 'CT YE after provision');
    const periodsB = await ensureFiscalYearPeriods(supabase, companyB, 2026);
    const janB = periodsB.get('2026-01-01')!;
    const cashB = await getAccountIdByNumber(supabase, companyB, '1020');
    const incomeB = await getAccountIdByNumber(supabase, companyB, '4000');
    await postIncome(journal, companyB, janB, cashB, incomeB, 400_000, '2026-01-15', 'YE P&L B');
    await ct.postProvision(
      { company_id: companyB, fiscal_year: 2026 },
      INTEGRATION_USER_ID,
      CompanyRole.Owner,
    );
    const closed = await journal.runYearEndClosing(
      { company_id: companyB, fiscal_year: 2026 },
      INTEGRATION_USER_ID,
    );
    expect(closed.entry.entry_type).toBe(JournalEntryType.YearEndClosing);
  });

  it('QFZP taxes NQI at standard_rate, not qfzp_rate [G-15 / G-34]', async () => {
    const companyId = await mintFreshIntegrationCompany(supabase, 'CT QFZP');
    const { error: fzErr } = await supabase.client
      .from('companies')
      .update({ is_free_zone_entity: true })
      .eq('id', companyId);
    if (fzErr) throw fzErr;

    const periods = await ensureFiscalYearPeriods(supabase, companyId, 2026);
    const jan = periods.get('2026-01-01')!;
    const cash = await getAccountIdByNumber(supabase, companyId, '1020');
    const qi = await getAccountIdByNumber(supabase, companyId, '4300');
    const nqi = await getAccountIdByNumber(supabase, companyId, '4310');
    await postIncome(journal, companyId, jan, cash, qi, 100_000, '2026-01-10', 'QI 4300');
    await postIncome(journal, companyId, jan, cash, nqi, 100_000, '2026-01-11', 'NQI 4310');

    const estimate = (await ct.taxableProfit(companyId, 2026, CompanyRole.Owner)) as {
      is_qfzp_calculation: boolean;
      taxable_profit_estimate: string | number;
      ct_due: string | number;
      qualifying_income: string | number;
      non_qualifying_income: string | number;
      qfzp_rate: string | number;
      standard_rate: string | number;
    };
    expect(estimate.is_qfzp_calculation).toBe(true);
    // Standard band on the same TP (~200k < 375k) would be 0; QFZP taxes NQI from the first dirham.
    expect(Number(estimate.taxable_profit_estimate)).toBeLessThan(375_000);
    expect(Number(estimate.qualifying_income)).toBe(100_000);
    expect(Number(estimate.non_qualifying_income)).toBe(100_000);
    const qfzpRate = Number(estimate.qfzp_rate);
    const standardRate = Number(estimate.standard_rate);
    const nqiAmount = Number(estimate.non_qualifying_income);
    const qiAmount = Number(estimate.qualifying_income);
    expect(Number(estimate.ct_due)).toBe(
      (qiAmount * qfzpRate) / 100 + (nqiAmount * standardRate) / 100,
    );
    expect(Number(estimate.ct_due)).toBe(9000);
    expect(Number(estimate.ct_due)).not.toBe((nqiAmount * qfzpRate) / 100);
  });

  it('SBR fails when a prior year exceeded the revenue cap [G-17]', async () => {
    const companyId = await mintFreshIntegrationCompany(supabase, 'CT SBR prior');
    await ensureFiscalYearPeriods(supabase, companyId, 2025);
    const periods25 = await ensureFiscalYearPeriods(supabase, companyId, 2025);
    const periods26 = await ensureFiscalYearPeriods(supabase, companyId, 2026);
    const jan25 = periods25.get('2025-01-01')!;
    const jan26 = periods26.get('2026-01-01')!;
    const cash = await getAccountIdByNumber(supabase, companyId, '1020');
    const income = await getAccountIdByNumber(supabase, companyId, '4000');
    await postIncome(journal, companyId, jan25, cash, income, 3_500_000, '2025-01-15', 'prior over cap');
    await postIncome(journal, companyId, jan26, cash, income, 1_000_000, '2026-01-15', 'current under cap');

    const sbr = (await ct.sbrEligibility(companyId, 2026, CompanyRole.Owner)) as {
      eligible: boolean;
      revenue_cap_ok: boolean;
      sunset_ok: boolean;
    };
    expect(sbr.sunset_ok).toBe(true);
    expect(sbr.revenue_cap_ok).toBe(false);
    expect(sbr.eligible).toBe(false);
  });

  it('entertainment add-back is 50% of 5580; 5810/5930 are 100% [G-18]', async () => {
    const companyId = await mintFreshIntegrationCompany(supabase, 'CT addback');
    const periods = await ensureFiscalYearPeriods(supabase, companyId, 2026);
    const jan = periods.get('2026-01-01')!;
    const cash = await getAccountIdByNumber(supabase, companyId, '1020');
    const income = await getAccountIdByNumber(supabase, companyId, '4000');
    const ent = await getAccountIdByNumber(supabase, companyId, '5580');
    const vatPen = await getAccountIdByNumber(supabase, companyId, '5810');
    const fines = await getAccountIdByNumber(supabase, companyId, '5930');
    await postIncome(journal, companyId, jan, cash, income, 10_000, '2026-01-05', 'base income');
    await postExpense(journal, companyId, jan, cash, ent, 1_000, '2026-01-06', 'entertainment');
    await postExpense(journal, companyId, jan, cash, vatPen, 200, '2026-01-07', 'VAT penalty');
    await postExpense(journal, companyId, jan, cash, fines, 50, '2026-01-08', 'fines');

    const estimate = (await ct.taxableProfit(companyId, 2026, CompanyRole.Owner)) as {
      net_profit: string | number;
      entertainment_addback: string | number;
      other_addback: string | number;
    };
    expect(Number(estimate.entertainment_addback)).toBe(500);
    expect(Number(estimate.other_addback)).toBe(250);
    expect(Number(estimate.net_profit)).toBe(8750);
  });

  it('threshold alert is 90% of zero_rate_threshold, computed at read time [G-35]', async () => {
    const companyId = await mintFreshIntegrationCompany(supabase, 'CT alert');
    const periods = await ensureFiscalYearPeriods(supabase, companyId, 2026);
    const jan = periods.get('2026-01-01')!;
    const cash = await getAccountIdByNumber(supabase, companyId, '1020');
    const income = await getAccountIdByNumber(supabase, companyId, '4000');
    await postIncome(journal, companyId, jan, cash, income, 300_000, '2026-01-15', 'below 90%');

    const below = (await ct.taxableProfit(companyId, 2026, CompanyRole.Owner)) as {
      taxable_profit_estimate: string | number;
      zero_rate_threshold: string | number;
      alert_threshold_pct: string | number;
      threshold_alert: boolean;
    };
    const alertAt = Number(
      (
        (Number(below.zero_rate_threshold) * Number(below.alert_threshold_pct)) /
        100
      ).toFixed(2),
    );
    expect(Number(below.taxable_profit_estimate)).toBeLessThan(alertAt);
    expect(below.threshold_alert).toBe(false);

    await postIncome(journal, companyId, jan, cash, income, 40_000, '2026-01-16', 'cross 90%');
    const above = (await ct.taxableProfit(companyId, 2026, CompanyRole.Owner)) as {
      taxable_profit_estimate: string | number;
      threshold_alert: boolean;
    };
    expect(Number(above.taxable_profit_estimate)).toBeGreaterThanOrEqual(alertAt);
    expect(above.threshold_alert).toBe(true);
  });

  it('summarize_free_zone_income excludes draft and void invoices [G-37]', async () => {
    const companyId = await mintFreshIntegrationCompany(supabase, 'CT FZ invoices');
    const { error: fzErr } = await supabase.client
      .from('companies')
      .update({ is_free_zone_entity: true })
      .eq('id', companyId);
    if (fzErr) throw fzErr;
    await ensureFiscalYearPeriods(supabase, companyId, 2026);
    const qiAcct = await getAccountIdByNumber(supabase, companyId, '4300');
    const nqiAcct = await getAccountIdByNumber(supabase, companyId, '4310');
    const customer = await customers.create({
      company_id: companyId,
      customer_name: 'FZ customer',
      trn: `7${Date.now()}`.slice(0, 15),
    });

    const line = (
      incomeAccountId: string,
      unitPrice: number,
      description: string,
    ) => ({
      company_id: companyId,
      customer_id: customer.id,
      invoice_date: '2026-01-20',
      payment_terms: PaymentTermsType.Net30,
      lines: [
        {
          line_number: 1,
          description,
          quantity: 1,
          unit_price: unitPrice,
          vat_rate: 0,
          income_account_id: incomeAccountId,
        },
      ],
    });

    await invoices.create(line(nqiAcct, 200_000, 'draft NQI'), INTEGRATION_USER_ID);

    const issuedQi = await invoices.create(line(qiAcct, 50_000, 'issued QI'), INTEGRATION_USER_ID);
    await invoices.issue(issuedQi.invoice.id);

    const issuedNqi = await invoices.create(line(nqiAcct, 10_000, 'issued NQI'), INTEGRATION_USER_ID);
    await invoices.issue(issuedNqi.invoice.id);

    const toVoid = await invoices.create(line(nqiAcct, 150_000, 'void NQI'), INTEGRATION_USER_ID);
    await invoices.issue(toVoid.invoice.id);
    await invoices.void(toVoid.invoice.id, { void_reason: 'G-37 exclude void' }, INTEGRATION_USER_ID);

    const summary = (await ct.freeZoneSummary(companyId, 2026, CompanyRole.Owner)) as {
      qualifying_income: string | number;
      non_qualifying_income: string | number;
    };
    expect(Number(summary.qualifying_income)).toBe(50_000);
    expect(Number(summary.non_qualifying_income)).toBe(10_000);
  });

  it('related_party_transactions has no update/delete path [G-26]', () => {
    const proto = Object.getOwnPropertyNames(CtController.prototype);
    expect(proto).not.toContain('update');
    expect(proto).not.toContain('remove');
    expect(proto).not.toContain('delete');
    expect(proto.filter((n) => /update|delete|patch/i.test(n))).toEqual([]);
    expect('updateRelatedParty' in repo).toBe(false);
    expect('deleteRelatedParty' in repo).toBe(false);
  });

  // [feature-spec-1_1_G.md G-36] isolation covers the three tenant tables
  // (ct_income_adjustments, ct_provision_entries, related_party_transactions).
  // ct_tax_rule_versions is global regulatory config like vat_tax_rule_versions
  // (F-23 analogue) — no company_id, no company_isolation_*.
  it('company-scoped queries never return another company\'s CT rows', async () => {
    const a = await mintFreshIntegrationCompany(supabase, 'CT rls A');
    const b = await mintFreshIntegrationCompany(supabase, 'CT rls B');
    await ct.recordRelatedParty(
      {
        company_id: a,
        counterparty_name: 'Party A',
        relationship: RelatedPartyRelationship.Shareholder,
        transaction_type: 'loan',
        amount: 100,
        transaction_date: '2026-03-01',
      },
      CompanyRole.Owner,
    );
    await ct.recordRelatedParty(
      {
        company_id: b,
        counterparty_name: 'Party B',
        relationship: RelatedPartyRelationship.Director,
        transaction_type: 'fee',
        amount: 200,
        transaction_date: '2026-03-02',
      },
      CompanyRole.Owner,
    );

    const listedA = (await ct.listRelatedParty(a, CompanyRole.Owner)) as Array<{
      company_id: string;
      counterparty_name: string;
    }>;
    expect(listedA.every((row) => row.company_id === a)).toBe(true);
    expect(listedA.some((row) => row.counterparty_name === 'Party B')).toBe(false);

    const periodsA = await ensureFiscalYearPeriods(supabase, a, 2026);
    const periodsB = await ensureFiscalYearPeriods(supabase, b, 2026);
    const cashA = await getAccountIdByNumber(supabase, a, '1020');
    const incomeA = await getAccountIdByNumber(supabase, a, '4000');
    const cashB = await getAccountIdByNumber(supabase, b, '1020');
    const incomeB = await getAccountIdByNumber(supabase, b, '4000');
    await postIncome(journal, a, periodsA.get('2026-01-01')!, cashA, incomeA, 500_000, '2026-01-15', 'A');
    await postIncome(journal, b, periodsB.get('2026-01-01')!, cashB, incomeB, 500_000, '2026-01-15', 'B');
    await ct.postProvision({ company_id: a, fiscal_year: 2026 }, INTEGRATION_USER_ID, CompanyRole.Owner);
    await ct.postProvision({ company_id: b, fiscal_year: 2026 }, INTEGRATION_USER_ID, CompanyRole.Owner);

    const provA = (await ct.listProvisions(a, 2026, CompanyRole.Owner)) as Array<{ company_id: string }>;
    expect(provA).toHaveLength(1);
    expect(provA[0].company_id).toBe(a);

    const { data: adjA, error: adjErr } = await supabase.client
      .from('ct_income_adjustments')
      .insert({
        company_id: a,
        fiscal_year: 2026,
        adjustment_type: 'qualifying_dividend',
        amount: 10,
        journal_entry_id: (
          await supabase.client
            .from('journal_entries')
            .select('id')
            .eq('company_id', a)
            .limit(1)
            .single()
        ).data?.id,
        recorded_by: INTEGRATION_USER_ID,
      })
      .select('company_id');
    if (adjErr) throw adjErr;
    expect(adjA?.[0].company_id).toBe(a);

    const { data: leakedAdj, error: leakErr } = await supabase.client
      .from('ct_income_adjustments')
      .select('company_id')
      .eq('company_id', a);
    if (leakErr) throw leakErr;
    expect((leakedAdj ?? []).every((row) => row.company_id === a)).toBe(true);
  });

  it('ct_due = 0 posts posted_nil with null JE and year-end succeeds [G-41]', async () => {
    const companyId = await mintFreshIntegrationCompany(supabase, 'CT posted_nil');
    const periods = await ensureFiscalYearPeriods(supabase, companyId, 2026);
    const jan = periods.get('2026-01-01')!;
    const cash = await getAccountIdByNumber(supabase, companyId, '1020');
    const income = await getAccountIdByNumber(supabase, companyId, '4000');
    await postIncome(journal, companyId, jan, cash, income, 10_000, '2026-01-15', 'below threshold');

    const posted = (await ct.postProvision(
      { company_id: companyId, fiscal_year: 2026 },
      INTEGRATION_USER_ID,
      CompanyRole.Owner,
    )) as {
      provision: {
        status: string;
        ct_due: string | number;
        provision_journal_entry_id: string | null;
      };
      entry: unknown;
    };
    expect(posted.provision.status).toBe('posted_nil');
    expect(Number(posted.provision.ct_due)).toBe(0);
    expect(posted.provision.provision_journal_entry_id).toBeNull();
    expect(posted.entry).toBeNull();

    const closed = await journal.runYearEndClosing(
      { company_id: companyId, fiscal_year: 2026 },
      INTEGRATION_USER_ID,
    );
    expect(closed.entry.entry_type).toBe(JournalEntryType.YearEndClosing);
  });

  it('CHECK rejects posted with null JE and posted_nil with ct_due <> 0 [G-41]', async () => {
    const companyId = await mintFreshIntegrationCompany(supabase, 'CT status check');
    const base = {
      company_id: companyId,
      fiscal_year: 2026,
      taxable_profit_estimate: 100,
      payment_due_date: '2027-09-30',
    };

    const postedNullJe = await supabase.client.from('ct_provision_entries').insert({
      ...base,
      ct_due: 10,
      status: 'posted',
      provision_journal_entry_id: null,
    });
    expect(postedNullJe.error?.code).toBe('23514');

    const nilWithDue = await supabase.client.from('ct_provision_entries').insert({
      ...base,
      ct_due: 10,
      status: 'posted_nil',
      provision_journal_entry_id: null,
    });
    expect(nilWithDue.error?.code).toBe('23514');
  });
});
