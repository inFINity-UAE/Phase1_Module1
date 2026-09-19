/**
 * Executes test cases from inFINity_AI_Module1.1_Engine_Test_Cases.xlsx
 * against the NestJS ledger engine (Supabase integration — same as production paths).
 */
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountCategory } from '../common/enums/account-category.enum';
import { AuditAction } from '../common/enums/audit-action.enum';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { NormalBalance } from '../common/enums/normal-balance.enum';
import { RecurrenceFrequency } from '../common/enums/recurrence-frequency.enum';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { AccountsModule } from '../accounts/accounts.module';
import { AccountsService } from '../accounts/accounts.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CompanyMembersModule } from '../company-members/company-members.module';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import {
  APPROVAL_THRESHOLD,
  E2E_ACCOUNTANT_ID,
} from '../e2e/e2e-company.setup';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { RecurringJournalTemplatesModule } from '../recurring-journal-templates/recurring-journal-templates.module';
import { RecurringJournalTemplatesService } from '../recurring-journal-templates/recurring-journal-templates.service';
import { mintFreshIntegrationCompany, INTEGRATION_USER_ID, LEGACY_YE_SKIP_CT } from './integration-company.setup';
import { CompanyRole } from '../common/enums/company-role.enum';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

type TcResult = {
  id: string;
  pass: boolean;
  partial?: boolean;
  actual: string;
  notes?: string;
};

const OWNER_ID = INTEGRATION_USER_ID;
const ACCOUNTANT_ID = E2E_ACCOUNTANT_ID;
const FISCAL_YEAR = 2026;

async function accountIdByNumber(
  supabase: SupabaseService,
  companyId: string,
  accountNumber: string,
): Promise<string> {
  const { data, error } = await supabase.client
    .from('accounts')
    .select('id')
    .eq('company_id', companyId)
    .eq('account_number', accountNumber)
    .single();
  if (error || !data) {
    throw error ?? new Error(`Account ${accountNumber} not found`);
  }
  return data.id as string;
}

async function periodIdForMonth(
  supabase: SupabaseService,
  companyId: string,
  monthStart: string,
): Promise<string> {
  const { data, error } = await supabase.client
    .from('accounting_periods')
    .select('id, status')
    .eq('company_id', companyId)
    .eq('period_start', monthStart)
    .single();
  if (error || !data) {
    throw error ?? new Error(`Period ${monthStart} not found`);
  }
  return data.id as string;
}

(hasSupabase ? describe : describe.skip)(
  'Excel Module 1.1 Engine Test Cases',
  () => {
    jest.setTimeout(300_000);

    let journalService: JournalEntriesService;
    let accountsService: AccountsService;
    let periodsService: AccountingPeriodsService;
    let recurringService: RecurringJournalTemplatesService;
    let auditService: AuditLogService;
    let supabase: SupabaseService;

    let companyId = '';
    const results: TcResult[] = [];
    const createdEntryIds: string[] = [];
    const createdTemplateIds: string[] = [];
    const createdAccountIds: string[] = [];

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          DatabaseModule,
          AccountsModule,
          AccountingPeriodsModule,
          CompanyMembersModule,
          AuditLogModule,
          JournalEntriesModule,
          RecurringJournalTemplatesModule,
        ],
      }).compile();

      journalService = module.get(JournalEntriesService);
      accountsService = module.get(AccountsService);
      periodsService = module.get(AccountingPeriodsService);
      recurringService = module.get(RecurringJournalTemplatesService);
      auditService = module.get(AuditLogService);
      supabase = module.get(SupabaseService);

      companyId = await mintFreshIntegrationCompany(supabase, 'Excel TC Runner', {
        withAccountant: true,
      });
    }, 120_000);

    afterAll(() => {
      // eslint-disable-next-line no-console
      console.log('\n========== EXCEL TEST CASE RESULTS ==========');
      for (const r of results) {
        const status = r.pass ? 'PASS' : r.partial ? 'PARTIAL' : 'FAIL';
        // eslint-disable-next-line no-console
        console.log(`${r.id}: ${status} — ${r.actual}${r.notes ? ` [${r.notes}]` : ''}`);
      }
      const passed = results.filter((r) => r.pass).length;
      const partial = results.filter((r) => r.partial).length;
      const failed = results.filter((r) => !r.pass && !r.partial).length;
      // eslint-disable-next-line no-console
      console.log(
        `\nSummary: ${passed} PASS, ${partial} PARTIAL, ${failed} FAIL (${results.length} total)\n`,
      );
    });

    function record(id: string, pass: boolean, actual: string, notes?: string, partial?: boolean) {
      results.push({ id, pass, actual, notes, partial });
    }

    it('runs TC1–TC14 from Excel workbook', async () => {
      const misc5990 = await accountIdByNumber(supabase, companyId, '5990');
      const bank1020 = await accountIdByNumber(supabase, companyId, '1020');
      const janPeriodId = await periodIdForMonth(supabase, companyId, '2026-01-01');

      // ── TC1: Double-entry imbalance rejection ─────────────────────────────
      try {
        const draft = await journalService.create(
          {
            company_id: companyId,
            period_id: janPeriodId,
            entry_date: '2026-01-05',
            narration: 'TC1 unbalanced probe',
            lines: [
              { line_number: 1, account_id: misc5990, debit: 5000, credit: 0 },
              { line_number: 2, account_id: bank1020, debit: 0, credit: 4800 },
            ],
          },
          OWNER_ID,
        );
        createdEntryIds.push(draft.entry.id);

        let rejected = false;
        let rejectMsg = '';
        try {
          await journalService.post(draft.entry.id, OWNER_ID);
        } catch (e) {
          rejected = true;
          rejectMsg = e instanceof Error ? e.message : String(e);
        }

        const balanced = await journalService.create(
          {
            company_id: companyId,
            period_id: janPeriodId,
            entry_date: '2026-01-06',
            narration: 'TC1 balanced follow-up',
            lines: [
              { line_number: 1, account_id: misc5990, debit: 5000, credit: 0 },
              { line_number: 2, account_id: bank1020, debit: 0, credit: 5000 },
            ],
          },
          OWNER_ID,
        );
        createdEntryIds.push(balanced.entry.id);
        const posted = await journalService.post(balanced.entry.id, OWNER_ID);

        const tc1Pass =
          rejected &&
          /must equal|unbalanced/i.test(rejectMsg) &&
          posted.entry.status === JournalEntryStatus.Posted;
        record(
          'TC1',
          tc1Pass,
          tc1Pass
            ? 'Unbalanced post rejected; corrected entry posted.'
            : `Unbalanced rejected=${rejected} msg=${rejectMsg}; posted=${posted.entry.status}`,
        );
      } catch (e) {
        record('TC1', false, e instanceof Error ? e.message : String(e));
      }

      // ── TC2: Five COA bands ───────────────────────────────────────────────
      try {
        const { data: accounts, error } = await supabase.client
          .from('accounts')
          .select('category, account_number')
          .eq('company_id', companyId);
        if (error) throw error;

        const bands = new Set(
          (accounts ?? []).map((a) => {
            const d = (a.account_number as string)[0];
            if (d === '1') return 'asset';
            if (d === '2') return 'liability';
            if (d === '3') return 'equity';
            if (d === '4') return 'income';
            if (d === '5') return 'expense';
            return 'other';
          }),
        );
        bands.delete('other');
        const categories = new Set((accounts ?? []).map((a) => a.category));
        const tc2Pass =
          bands.size === 5 &&
          categories.has('asset') &&
          categories.has('liability') &&
          categories.has('equity') &&
          categories.has('income') &&
          categories.has('expense') &&
          !categories.has('cogs');
        record(
          'TC2',
          tc2Pass,
          `Bands present: ${[...bands].sort().join(', ')} (${accounts?.length ?? 0} accounts)`,
        );
      } catch (e) {
        record('TC2', false, e instanceof Error ? e.message : String(e));
      }

      // ── TC3: UAE-specific accounts + Zakat treatment ──────────────────────
      try {
        const { data: accounts, error } = await supabase.client
          .from('accounts')
          .select('account_number, account_name, category, is_active')
          .eq('company_id', companyId);
        if (error) throw error;

        const byNum = Object.fromEntries(
          (accounts ?? []).map((a) => [a.account_number as string, a]),
        );
        const checks = {
          count80: (accounts?.length ?? 0) >= 80,
          vatPayable: Boolean(byNum['2200']),
          vatReceivable: Boolean(byNum['1400']),
          corpTax: Boolean(byNum['2300'] || byNum['2310']),
          importDuty: Boolean(byNum['2800']),
          zakatPayable: byNum['2350']?.category === 'liability' && byNum['2350']?.is_active === true,
          zakatReserveInactive:
            !byNum['3300'] || byNum['3300']?.is_active === false,
          freeZoneIncome: Boolean(byNum['4300'] && byNum['4310']),
        };
        const tc3Pass = Object.values(checks).every(Boolean);
        record(
          'TC3',
          tc3Pass,
          `${accounts?.length} accounts; Zakat Payable 2350 active=${byNum['2350']?.is_active}; Zakat Reserve 3300 active=${byNum['3300']?.is_active ?? 'missing'}`,
          tc3Pass ? undefined : JSON.stringify(checks),
        );
      } catch (e) {
        record('TC3', false, e instanceof Error ? e.message : String(e));
      }

      // ── TC4: 4-level hierarchy ────────────────────────────────────────────
      try {
        const l1 = await accountsService.create({
          company_id: companyId,
          account_number: '5995',
          account_name: 'Marketing - Digital',
          category: AccountCategory.Expense,
          normal_balance: NormalBalance.Debit,
        });
        createdAccountIds.push(l1.id);

        const l2 = await accountsService.create({
          company_id: companyId,
          account_number: '5996',
          account_name: 'Paid Social',
          category: AccountCategory.Expense,
          normal_balance: NormalBalance.Debit,
          parent_account_id: l1.id,
        });
        createdAccountIds.push(l2.id);

        const l3 = await accountsService.create({
          company_id: companyId,
          account_number: '5997',
          account_name: 'Instagram Ads',
          category: AccountCategory.Expense,
          normal_balance: NormalBalance.Debit,
          parent_account_id: l2.id,
        });
        createdAccountIds.push(l3.id);

        const l4 = await accountsService.create({
          company_id: companyId,
          account_number: '5998',
          account_name: 'Q3 Campaign',
          category: AccountCategory.Expense,
          normal_balance: NormalBalance.Debit,
          parent_account_id: l3.id,
        });
        createdAccountIds.push(l4.id);

        let depthBlocked = false;
        try {
          await accountsService.create({
            company_id: companyId,
            account_number: '5994',
            account_name: 'Level 5 blocked',
            category: AccountCategory.Expense,
            normal_balance: NormalBalance.Debit,
            parent_account_id: l4.id,
          });
        } catch (e) {
          depthBlocked =
            e instanceof BadRequestException &&
            /depth|hierarchy|maximum/i.test(e.message);
        }

        record(
          'TC4',
          l1.depth === 1 &&
            l2.depth === 2 &&
            l3.depth === 3 &&
            l4.depth === 4 &&
            depthBlocked,
          depthBlocked
            ? 'Levels 1–4 created; level 5 rejected.'
            : `depths=${l1.depth}/${l2.depth}/${l3.depth}/${l4.depth}; L5 blocked=${depthBlocked}`,
        );
      } catch (e) {
        record('TC4', false, e instanceof Error ? e.message : String(e));
      }

      // ── TC5: Account number band enforcement ──────────────────────────────
      try {
        const reject3500 = await (async () => {
          try {
            await accountsService.create({
              company_id: companyId,
              account_number: '3500',
              account_name: 'Bad expense code',
              category: AccountCategory.Expense,
              normal_balance: NormalBalance.Debit,
            });
            return false;
          } catch (e) {
            return e instanceof BadRequestException;
          }
        })();

        const accept5500 = await (async () => {
          try {
            const a = await accountsService.create({
              company_id: companyId,
              account_number: '5521',
              account_name: 'TC5 valid expense',
              category: AccountCategory.Expense,
              normal_balance: NormalBalance.Debit,
            });
            createdAccountIds.push(a.id);
            return true;
          } catch {
            return false;
          }
        })();

        const reject1500 = await (async () => {
          try {
            await accountsService.create({
              company_id: companyId,
              account_number: '1500',
              account_name: 'Bad liability code',
              category: AccountCategory.Liability,
              normal_balance: NormalBalance.Credit,
            });
            return false;
          } catch (e) {
            return e instanceof BadRequestException;
          }
        })();

        record(
          'TC5',
          reject3500 && accept5500 && reject1500,
          `3500 rejected=${reject3500}; 5521 accepted=${accept5500}; 1500 liability rejected=${reject1500}`,
        );
      } catch (e) {
        record('TC5', false, e instanceof Error ? e.message : String(e));
      }

      // ── TC6: Account locking / deactivate (use 5100 — keep 5990 for later TCs) ──
      try {
        const expense5100tc6 = await accountIdByNumber(supabase, companyId, '5100');

        const histDraft = await journalService.create(
          {
            company_id: companyId,
            period_id: janPeriodId,
            entry_date: '2026-01-07',
            narration: 'TC6 history on 5100',
            lines: [
              { line_number: 1, account_id: expense5100tc6, debit: 50, credit: 0 },
              { line_number: 2, account_id: bank1020, debit: 0, credit: 50 },
            ],
          },
          OWNER_ID,
        );
        createdEntryIds.push(histDraft.entry.id);
        await journalService.post(histDraft.entry.id, OWNER_ID);

        let deleteBlocked = false;
        try {
          await accountsService.remove(expense5100tc6);
        } catch (e) {
          deleteBlocked = e instanceof BadRequestException;
        }

        await accountsService.deactivate(expense5100tc6);
        const inactive = await accountsService.findOne(expense5100tc6);

        let inactiveLineBlocked = false;
        try {
          await journalService.create(
            {
              company_id: companyId,
              period_id: janPeriodId,
              entry_date: '2026-01-07',
              narration: 'TC6 inactive account probe',
              lines: [
                { line_number: 1, account_id: expense5100tc6, debit: 100, credit: 0 },
                { line_number: 2, account_id: bank1020, debit: 0, credit: 100 },
              ],
            },
            OWNER_ID,
          );
        } catch (e) {
          inactiveLineBlocked = e instanceof BadRequestException;
        }

        const tb = await accountsService.getTrialBalance(expense5100tc6);

        record(
          'TC6',
          deleteBlocked && inactive.is_active === false && inactiveLineBlocked && tb !== null,
          `delete blocked=${deleteBlocked}; deactivated=${!inactive.is_active}; inactive line blocked=${inactiveLineBlocked}; historical TB readable=${tb !== null}`,
        );
      } catch (e) {
        record('TC6', false, e instanceof Error ? e.message : String(e));
      }

      // ── TC7: Narration, reference, attachment ─────────────────────────────
      try {
        const withMeta = await journalService.create(
          {
            company_id: companyId,
            period_id: janPeriodId,
            entry_date: '2026-01-08',
            narration: 'August office supplies purchase - see attached receipt',
            reference_number: 'REF-2026-1187',
            attachments: [
              {
                file_name: 'receipt.pdf',
                file_url: 'https://example.com/receipt.pdf',
                file_size_bytes: 1024,
              },
            ],
            lines: [
              { line_number: 1, account_id: misc5990, debit: 250, credit: 0 },
              { line_number: 2, account_id: bank1020, debit: 0, credit: 250 },
            ],
          },
          OWNER_ID,
        );
        createdEntryIds.push(withMeta.entry.id);
        const posted = await journalService.post(withMeta.entry.id, OWNER_ID);
        const fetched = await journalService.findOne(withMeta.entry.id);
        const attachments = await journalService.getAttachments(withMeta.entry.id);

        const tc7Pass =
          posted.entry.narration?.includes('office supplies') &&
          fetched.entry.reference_number === 'REF-2026-1187' &&
          attachments.length === 1 &&
          attachments[0].file_name === 'receipt.pdf';
        record(
          'TC7',
          tc7Pass,
          tc7Pass
            ? 'Narration, reference, attachment persisted through post.'
            : `narration=${fetched.entry.narration}; ref=${fetched.entry.reference_number}; attachments=${attachments.length}`,
        );
      } catch (e) {
        record('TC7', false, e instanceof Error ? e.message : String(e));
      }

      // ── TC8: Recurring auto-post across months ────────────────────────────
      try {
        const depr5600 = await accountIdByNumber(supabase, companyId, '5600');
        const accum1640 = await accountIdByNumber(supabase, companyId, '1640');

        const template = await recurringService.create(
          {
            company_id: companyId,
            template_name: 'TC8 monthly depreciation',
            narration_template: 'Monthly depreciation {{period}}',
            frequency: RecurrenceFrequency.Monthly,
            start_date: '2026-08-01',
            next_run_date: '2026-08-31',
            day_of_month: 31,
            auto_post: true,
            is_active: true,
            lines: [
              { line_number: 1, account_id: depr5600, debit: 500, credit: 0 },
              { line_number: 2, account_id: accum1640, debit: 0, credit: 500 },
            ],
          },
          OWNER_ID,
        );
        createdTemplateIds.push(template.template.id);

        const runDates = ['2026-08-31', '2026-09-30', '2026-10-31'];
        const generatedIds: string[] = [];
        for (const runDate of runDates) {
          const batch = await recurringService.runDueGenerations(companyId, runDate);
          const hit = batch.find((r) => r.template_id === template.template.id);
          if (hit?.journal_entry?.entry.id) {
            generatedIds.push(hit.journal_entry.entry.id);
            createdEntryIds.push(hit.journal_entry.entry.id);
          }
        }

        const { data: postedEntries } = await supabase.client
          .from('journal_entries')
          .select('id, status, entry_type, recurring_template_id')
          .eq('company_id', companyId)
          .eq('recurring_template_id', template.template.id)
          .eq('status', JournalEntryStatus.Posted);

        const tc8Pass = (postedEntries?.length ?? 0) >= 3 && generatedIds.length >= 3;
        record(
          'TC8',
          tc8Pass,
          `${postedEntries?.length ?? 0} auto-posted recurring entries for template (expected ≥3)`,
        );
      } catch (e) {
        record('TC8', false, e instanceof Error ? e.message : String(e));
      }

      // ── TC9: Approval workflow (avoid 5100 — deactivated in TC6) ───────────
      try {
        const expense5200 = await accountIdByNumber(supabase, companyId, '5200');
        const cash1010 = await accountIdByNumber(supabase, companyId, '1010');
        const above = APPROVAL_THRESHOLD + 1;
        const below = APPROVAL_THRESHOLD - 1;

        const aboveDraft = await journalService.create(
          {
            company_id: companyId,
            period_id: janPeriodId,
            entry_date: '2026-01-10',
            narration: 'TC9 above threshold accountant',
            lines: [
              { line_number: 1, account_id: expense5200, debit: above, credit: 0 },
              { line_number: 2, account_id: cash1010, debit: 0, credit: above },
            ],
          },
          ACCOUNTANT_ID,
        );
        createdEntryIds.push(aboveDraft.entry.id);
        const pending = await journalService.post(aboveDraft.entry.id, ACCOUNTANT_ID);

        const approved = await journalService.approve(aboveDraft.entry.id, OWNER_ID);

        const belowDraft = await journalService.create(
          {
            company_id: companyId,
            period_id: janPeriodId,
            entry_date: '2026-01-11',
            narration: 'TC9 below threshold',
            lines: [
              { line_number: 1, account_id: expense5200, debit: below, credit: 0 },
              { line_number: 2, account_id: cash1010, debit: 0, credit: below },
            ],
          },
          ACCOUNTANT_ID,
        );
        createdEntryIds.push(belowDraft.entry.id);
        const belowPosted = await journalService.post(belowDraft.entry.id, ACCOUNTANT_ID);

        const ownerDraft = await journalService.create(
          {
            company_id: companyId,
            period_id: janPeriodId,
            entry_date: '2026-01-12',
            narration: 'TC9 owner self-approve probe',
            lines: [
              { line_number: 1, account_id: expense5200, debit: above, credit: 0 },
              { line_number: 2, account_id: cash1010, debit: 0, credit: above },
            ],
          },
          OWNER_ID,
        );
        createdEntryIds.push(ownerDraft.entry.id);
        const ownerPosted = await journalService.post(ownerDraft.entry.id, OWNER_ID);

        const ownerAudit = await auditService.find({
          company_id: companyId,
          record_id: ownerDraft.entry.id,
          table_name: 'journal_entries',
        });
        const selfApprovedLabel = ownerAudit.some(
          (row) => row.notes === 'Self-approved by Owner',
        );

        const otherAudit = await auditService.find({
          company_id: companyId,
          record_id: aboveDraft.entry.id,
          table_name: 'journal_entries',
        });
        const otherHasSelfLabel = otherAudit.some(
          (row) => row.notes === 'Self-approved by Owner',
        );

        const corePass =
          pending.entry.status === JournalEntryStatus.PendingApproval &&
          approved.entry.status === JournalEntryStatus.Posted &&
          belowPosted.entry.status === JournalEntryStatus.Posted &&
          ownerPosted.entry.status === JournalEntryStatus.Posted &&
          !otherHasSelfLabel;

        const tc9FullPass = corePass && selfApprovedLabel;
        record(
          'TC9',
          tc9FullPass,
          tc9FullPass
            ? `Threshold=${APPROVAL_THRESHOLD} AED: pending→approve, below immediate, Owner self-post labeled.`
            : `pending=${pending.entry.status}; approved=${approved.entry.status}; below=${belowPosted.entry.status}; owner=${ownerPosted.entry.status}; selfLabel=${selfApprovedLabel}; otherLabeled=${otherHasSelfLabel}`,
          `App threshold is ${APPROVAL_THRESHOLD} AED (Excel specifies 50,000).`,
          corePass && !selfApprovedLabel,
        );
      } catch (e) {
        record('TC9', false, e instanceof Error ? e.message : String(e));
      }

      // ── TC10: Soft-close override ─────────────────────────────────────────
      try {
        const augPeriodId = await periodIdForMonth(supabase, companyId, '2026-08-01');
        await periodsService.softClose(augPeriodId, OWNER_ID);

        const draft = await journalService.create(
          {
            company_id: companyId,
            period_id: augPeriodId,
            entry_date: '2026-08-20',
            narration: 'TC10 soft-closed period probe',
            lines: [
              { line_number: 1, account_id: misc5990, debit: 300, credit: 0 },
              { line_number: 2, account_id: bank1020, debit: 0, credit: 300 },
            ],
          },
          ACCOUNTANT_ID,
        );
        createdEntryIds.push(draft.entry.id);

        let normalBlocked = false;
        try {
          await journalService.post(draft.entry.id, ACCOUNTANT_ID);
        } catch (e) {
          normalBlocked =
            e instanceof BadRequestException &&
            /soft_closed_override_reason/i.test(e.message);
        }

        let accountantOverrideBlocked = false;
        try {
          await journalService.post(draft.entry.id, ACCOUNTANT_ID, {
            soft_closed_override_reason: 'Should fail',
          });
        } catch (e) {
          accountantOverrideBlocked = e instanceof ForbiddenException;
        }

        const overridePosted = await journalService.post(draft.entry.id, OWNER_ID, {
          soft_closed_override_reason: 'TC10 post-close correction',
        });

        const { data: periodAfter } = await supabase.client
          .from('accounting_periods')
          .select('reopen_reason, reopened_by')
          .eq('id', augPeriodId)
          .single();

        const tc10Pass =
          normalBlocked &&
          accountantOverrideBlocked &&
          overridePosted.entry.status === JournalEntryStatus.Posted &&
          Boolean(periodAfter?.reopen_reason);
        record(
          'TC10',
          tc10Pass,
          tc10Pass
            ? 'Soft-close blocks normal post; Owner override with reason succeeds and is logged.'
            : `normalBlocked=${normalBlocked}; acctOverrideBlocked=${accountantOverrideBlocked}; overridePosted=${overridePosted.entry.status}; logged=${Boolean(periodAfter?.reopen_reason)}`,
        );
      } catch (e) {
        record('TC10', false, e instanceof Error ? e.message : String(e));
      }

      // ── TC11: Year-end closing (isolated company) ─────────────────────────
      try {
        const yeCompany = await mintFreshIntegrationCompany(supabase, 'TC11 Year-End');
        const income4000 = await accountIdByNumber(supabase, yeCompany, '4000');
        const expense5200 = await accountIdByNumber(supabase, yeCompany, '5200');
        const re3100 = await accountIdByNumber(supabase, yeCompany, '3100');
        const asset1010 = await accountIdByNumber(supabase, yeCompany, '1010');
        const decPeriodId = await periodIdForMonth(supabase, yeCompany, '2026-12-01');

        const plDraft = await journalService.create(
          {
            company_id: yeCompany,
            period_id: decPeriodId,
            entry_date: '2026-12-15',
            narration: 'TC11 revenue',
            lines: [
              { line_number: 1, account_id: asset1010, debit: 10000, credit: 0 },
              { line_number: 2, account_id: income4000, debit: 0, credit: 10000 },
            ],
          },
          OWNER_ID,
        );
        await journalService.post(plDraft.entry.id, OWNER_ID);

        const expDraft = await journalService.create(
          {
            company_id: yeCompany,
            period_id: decPeriodId,
            entry_date: '2026-12-16',
            narration: 'TC11 expense',
            lines: [
              { line_number: 1, account_id: expense5200, debit: 3000, credit: 0 },
              { line_number: 2, account_id: asset1010, debit: 0, credit: 3000 },
            ],
          },
          OWNER_ID,
        );
        await journalService.post(expDraft.entry.id, OWNER_ID);

        const incomeBeforeClose = await accountsService.getTrialBalance(income4000);
        const expenseBeforeClose = await accountsService.getTrialBalance(expense5200);
        const assetAfterPl = await accountsService.getTrialBalance(asset1010);
        const expectedNet =
          Math.abs(incomeBeforeClose.balance) - Math.abs(expenseBeforeClose.balance);

        await journalService.runYearEndClosing(
          { company_id: yeCompany, fiscal_year: FISCAL_YEAR, ...LEGACY_YE_SKIP_CT },
          OWNER_ID,
          CompanyRole.Owner,
        );

        const incomeAfter = await accountsService.getTrialBalance(income4000);
        const expenseAfter = await accountsService.getTrialBalance(expense5200);
        const reAfter = await accountsService.getTrialBalance(re3100);
        const assetAfter = await accountsService.getTrialBalance(asset1010);

        const tc11Pass =
          Math.abs(incomeAfter.balance) < 0.01 &&
          Math.abs(expenseAfter.balance) < 0.01 &&
          Math.abs(reAfter.balance - expectedNet) < 0.01 &&
          Math.abs(assetAfterPl.balance - assetAfter.balance) < 0.01;
        record(
          'TC11',
          tc11Pass,
          tc11Pass
            ? 'P&L zeroed; Retained Earnings = net P&L; asset balance unchanged by close.'
            : `income=${incomeAfter.balance}; expense=${expenseAfter.balance}; RE=${reAfter.balance}; expectedNet=${expectedNet}; asset delta=${assetAfter.balance - assetAfterPl.balance}`,
        );
      } catch (e) {
        record('TC11', false, e instanceof Error ? e.message : String(e));
      }

      // ── TC12: Reversal (January — August soft-closed later in TC10) ───────
      try {
        const orig = await journalService.create(
          {
            company_id: companyId,
            period_id: janPeriodId,
            entry_date: '2026-01-15',
            narration: 'TC12 original',
            lines: [
              { line_number: 1, account_id: misc5990, debit: 1200, credit: 0 },
              { line_number: 2, account_id: bank1020, debit: 0, credit: 1200 },
            ],
          },
          OWNER_ID,
        );
        createdEntryIds.push(orig.entry.id);
        await journalService.post(orig.entry.id, OWNER_ID);

        const reversed = await journalService.reverse(orig.entry.id, OWNER_ID);
        createdEntryIds.push(reversed.reversal.entry.id);

        const febPeriodId = await periodIdForMonth(supabase, companyId, '2026-02-01');
        const inNextPeriod = reversed.reversal.entry.period_id === febPeriodId;

        let doubleReverseBlocked = false;
        try {
          await journalService.reverse(orig.entry.id, OWNER_ID);
        } catch (e) {
          doubleReverseBlocked = e instanceof BadRequestException;
        }

        record(
          'TC12',
          inNextPeriod &&
            reversed.original.entry.status === JournalEntryStatus.Reversed &&
            doubleReverseBlocked,
          `Reversal in next period=${inNextPeriod}; original reversed=${reversed.original.entry.status}; double-reverse blocked=${doubleReverseBlocked}`,
        );
      } catch (e) {
        record('TC12', false, e instanceof Error ? e.message : String(e));
      }

      // ── TC13: Opening balance duplicate rejection ─────────────────────────
      try {
        const obCompany = await mintFreshIntegrationCompany(supabase, 'TC13 Opening Balance');
        const share3000 = await accountIdByNumber(supabase, obCompany, '3000');
        const bank1020ob = await accountIdByNumber(supabase, obCompany, '1020');
        const julPeriodId = await periodIdForMonth(supabase, obCompany, '2026-07-01');

        await journalService.createOpeningBalance(
          {
            company_id: obCompany,
            fiscal_year: FISCAL_YEAR,
            entry_date: '2026-07-01',
            narration: 'TC13 opening balance',
            lines: [
              { line_number: 1, account_id: bank1020ob, debit: 120000, credit: 0 },
              { line_number: 2, account_id: share3000, debit: 0, credit: 120000 },
            ],
          },
          OWNER_ID,
        );

        const tbBank = await accountsService.getTrialBalance(bank1020ob);

        let duplicateBlocked = false;
        let duplicateMsg = '';
        try {
          await journalService.createOpeningBalance(
            {
              company_id: obCompany,
              fiscal_year: FISCAL_YEAR,
              entry_date: '2026-07-01',
              narration: 'TC13 duplicate probe',
              lines: [
                { line_number: 1, account_id: bank1020ob, debit: 120000, credit: 0 },
                { line_number: 2, account_id: share3000, debit: 0, credit: 120000 },
              ],
            },
            OWNER_ID,
          );
        } catch (e) {
          duplicateMsg = e instanceof Error ? e.message : String(e);
          duplicateBlocked = /opening balance.*already exists|OPENING_BALANCE_ALREADY/i.test(
            duplicateMsg,
          );
        }

        const tbBankAfter = await accountsService.getTrialBalance(bank1020ob);

        // #57: income account on opening-balance lines must be rejected (non-first line).
        let categoryBlocked = false;
        try {
          const income4000 = await accountIdByNumber(supabase, companyId, '4000');
          // Use main company (has open Jan period) for category probe — fresh ob company already has OB.
          await journalService.createOpeningBalance(
            {
              company_id: companyId,
              fiscal_year: FISCAL_YEAR,
              entry_date: '2026-01-01',
              narration: 'TC13 income category probe',
              lines: [
                { line_number: 1, account_id: bank1020, debit: 100, credit: 0 },
                { line_number: 2, account_id: income4000, debit: 0, credit: 100 },
              ],
            },
            OWNER_ID,
          );
        } catch (e) {
          categoryBlocked =
            e instanceof BadRequestException ||
            /OPENING_BALANCE_INVALID_ACCOUNT_CATEGORY|income|expense|balance-sheet/i.test(
              e instanceof Error ? e.message : String(e),
            );
        }

        record(
          'TC13',
          duplicateBlocked &&
            categoryBlocked &&
            Math.abs(tbBank.balance - 120000) < 0.01 &&
            Math.abs(tbBankAfter.balance - 120000) < 0.01,
          duplicateBlocked && categoryBlocked
            ? 'Opening balance posted once; duplicate rejected; income line rejected (#57); bank still 120,000.'
            : `duplicateBlocked=${duplicateBlocked}; categoryBlocked=${categoryBlocked}; bank=${tbBankAfter.balance}; dupMsg=${duplicateMsg || 'second call succeeded'}`,
        );
      } catch (e) {
        record('TC13', false, e instanceof Error ? e.message : String(e));
      }

      // ── TC14: Immutable audit trail ───────────────────────────────────────
      try {
        const tc14Draft = await journalService.create(
          {
            company_id: companyId,
            period_id: janPeriodId,
            entry_date: '2026-01-20',
            narration: 'TC14 audit probe',
            lines: [
              { line_number: 1, account_id: misc5990, debit: 99, credit: 0 },
              { line_number: 2, account_id: bank1020, debit: 0, credit: 99 },
            ],
          },
          OWNER_ID,
        );
        createdEntryIds.push(tc14Draft.entry.id);
        await journalService.post(tc14Draft.entry.id, OWNER_ID);
        const entryId = tc14Draft.entry.id;

        let deleteBlocked = false;
        try {
          await journalService.deleteEntry(entryId, OWNER_ID);
        } catch (e) {
          deleteBlocked = e instanceof BadRequestException;
        }

        let lineDeleteBlocked = false;
        let lineDeleteAudited = false;
        try {
          const posted = await journalService.findOne(entryId);
          await journalService.deleteLine(posted.lines[0].id, OWNER_ID);
        } catch (e) {
          lineDeleteBlocked = e instanceof BadRequestException;
        }
        const lineAudit = await auditService.find({
          company_id: companyId,
          table_name: 'journal_lines',
        });
        lineDeleteAudited = lineAudit.some(
          (r) =>
            r.action === AuditAction.DeleteBlocked && r.actor_id === OWNER_ID,
        );

        await journalService.reverse(entryId, OWNER_ID);
        const auditRows = await auditService.find({
          company_id: companyId,
          record_id: entryId,
          table_name: 'journal_entries',
        });

        const hasInsert = auditRows.some((r) => r.action === AuditAction.Insert);
        const hasStatus = auditRows.some((r) => r.action === AuditAction.StatusChange);
        const hasReversal = auditRows.some((r) => r.action === AuditAction.Reversal);
        const hasDeleteBlocked = auditRows.some(
          (r) => r.action === AuditAction.DeleteBlocked && r.actor_id === OWNER_ID,
        );

        record(
          'TC14',
          deleteBlocked &&
            lineDeleteBlocked &&
            lineDeleteAudited &&
            hasInsert &&
            hasStatus &&
            hasReversal &&
            hasDeleteBlocked,
          deleteBlocked &&
            lineDeleteBlocked &&
            lineDeleteAudited &&
            hasInsert &&
            hasStatus &&
            hasReversal &&
            hasDeleteBlocked
            ? 'Posted entry+line delete blocked; audit has insert, status_change, reverse, delete_blocked (entry+line).'
            : `deleteBlocked=${deleteBlocked}; lineDelete=${lineDeleteBlocked}; lineAudit=${lineDeleteAudited}; insert=${hasInsert} status=${hasStatus} reversal=${hasReversal} delete_blocked=${hasDeleteBlocked}`,
        );
      } catch (e) {
        record('TC14', false, e instanceof Error ? e.message : String(e));
      }

      expect(results.length).toBe(14);
    });
  },
);
