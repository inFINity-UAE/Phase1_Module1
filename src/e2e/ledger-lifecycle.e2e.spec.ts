import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditAction } from '../common/enums/audit-action.enum';
import { CompanyRole } from '../common/enums/company-role.enum';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { RecurrenceFrequency } from '../common/enums/recurrence-frequency.enum';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import {
  APPROVAL_THRESHOLD,
  E2E_ACCOUNTANT_ID,
  E2E_COMPANY_ID,
  E2E_OWNER_ID,
  ensureE2eCompanyReady,
  ensureFiscalYearPeriods,
  getAccountIdByNumber,
  resolveCleanFiscalYear,
} from './e2e-company.setup';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import {
  JOURNAL_ENTRIES_REPOSITORY,
  JournalEntriesRepository,
} from '../journal-entries/journal-entries.repository';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { RecurringJournalTemplatesModule } from '../recurring-journal-templates/recurring-journal-templates.module';
import { RecurringJournalTemplatesService } from '../recurring-journal-templates/recurring-journal-templates.service';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

(hasSupabase ? describe : describe.skip)(
  'Ledger lifecycle E2E regression (Stages 1–12)',
  () => {
    jest.setTimeout(180_000);

    let journalEntriesService: JournalEntriesService;
    let accountingPeriodsService: AccountingPeriodsService;
    let recurringService: RecurringJournalTemplatesService;
    let auditLogService: AuditLogService;
    let journalRepository: JournalEntriesRepository;
    let supabase: SupabaseService;

    let fiscalYear = 0;
    let janPeriodId = '';
    let cashAccountId = '';
    let openingEquityAccountId = '';
    let expenseAccountId = '';
    let incomeAccountId = '';

    const trackedEntryIds: string[] = [];

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          DatabaseModule,
          AccountingPeriodsModule,
          AuditLogModule,
          JournalEntriesModule,
          RecurringJournalTemplatesModule,
        ],
      }).compile();

      journalEntriesService = module.get(JournalEntriesService);
      accountingPeriodsService = module.get(AccountingPeriodsService);
      recurringService = module.get(RecurringJournalTemplatesService);
      auditLogService = module.get(AuditLogService);
      journalRepository = module.get(JOURNAL_ENTRIES_REPOSITORY);
      supabase = module.get(SupabaseService);

      await ensureE2eCompanyReady(supabase);
      fiscalYear = await resolveCleanFiscalYear(journalRepository, E2E_COMPANY_ID);
      const periods = await ensureFiscalYearPeriods(supabase, E2E_COMPANY_ID, fiscalYear);

      janPeriodId = periods.get(`${fiscalYear}-01-01`)!;

      cashAccountId = await getAccountIdByNumber(supabase, E2E_COMPANY_ID, '1011');
      openingEquityAccountId = await getAccountIdByNumber(supabase, E2E_COMPANY_ID, '3210');
      expenseAccountId = await getAccountIdByNumber(supabase, E2E_COMPANY_ID, '5010');
      incomeAccountId = await getAccountIdByNumber(supabase, E2E_COMPANY_ID, '4010');
    }, 120000);

    async function assertTrialBalanced(step: string): Promise<void> {
      const totals = await journalRepository.getTrialBalanceTotals(E2E_COMPANY_ID);
      expect(totals.total_debit).toBeCloseTo(totals.total_credit, 2);
      // eslint-disable-next-line no-console
      console.log(
        `[TB OK] ${step}: debits=${totals.total_debit.toFixed(2)} credits=${totals.total_credit.toFixed(2)}`,
      );
    }

    async function countAccounts(): Promise<number> {
      const { count, error } = await supabase.client
        .from('accounts')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', E2E_COMPANY_ID);

      if (error) {
        throw error;
      }

      return count ?? 0;
    }

    async function assertStatusChangeAudit(
      recordId: string,
      fromStatus: JournalEntryStatus,
      toStatus: JournalEntryStatus,
      step: string,
      extra?: (row: {
        old_data: Record<string, unknown> | null;
        new_data: Record<string, unknown> | null;
      }) => void,
    ): Promise<void> {
      const audit = await auditLogService.find({
        company_id: E2E_COMPANY_ID,
        record_id: recordId,
        table_name: 'journal_entries',
      });

      expect(audit.some((row) => row.action === AuditAction.Insert)).toBe(true);

      const statusChange = audit.find(
        (row) =>
          row.action === AuditAction.StatusChange &&
          row.old_data?.status === fromStatus &&
          row.new_data?.status === toStatus,
      );
      expect(statusChange).toBeDefined();
      expect(statusChange?.old_data?.status).toBe(fromStatus);
      expect(statusChange?.new_data?.status).toBe(toStatus);

      if (extra && statusChange) {
        extra(statusChange);
      }

      // eslint-disable-next-line no-console
      console.log(`[AUDIT OK] ${step}: ${fromStatus} → ${toStatus} status_change logged`);
    }

    it('runs the full accounting engine lifecycle with trial balance integrity at every step', async () => {
      // Stage 1 — COA seed
      const accountCount = await countAccounts();
      expect(accountCount).toBeGreaterThanOrEqual(80);
      await assertTrialBalanced('Stage 1 — COA seeded, no postings yet');

      // Stage 7 — Opening balance
      const openingBalance = await journalEntriesService.createOpeningBalance({
        company_id: E2E_COMPANY_ID,
        fiscal_year: fiscalYear,
        entry_date: `${fiscalYear}-01-01`,
        narration: `E2E opening balance FY${fiscalYear}`,
        created_by: E2E_OWNER_ID,
        lines: [
          { line_number: 1, account_id: cashAccountId, debit: 50_000, credit: 0 },
          { line_number: 2, account_id: openingEquityAccountId, debit: 0, credit: 50_000 },
        ],
      });
      trackedEntryIds.push(openingBalance.entry.id);
      expect(openingBalance.entry.entry_type).toBe(JournalEntryType.OpeningBalance);
      expect(openingBalance.entry.status).toBe(JournalEntryStatus.Posted);
      await assertTrialBalanced('Stage 7 — opening balance posted');

      // Stage 4/5 — Manual entry below approval threshold
      const belowThresholdDraft = await journalEntriesService.create({
        company_id: E2E_COMPANY_ID,
        period_id: janPeriodId,
        entry_date: `${fiscalYear}-01-10`,
        narration: 'E2E below-threshold expense',
        created_by: E2E_ACCOUNTANT_ID,
        lines: [
          { line_number: 1, account_id: expenseAccountId, debit: 4_000, credit: 0 },
          { line_number: 2, account_id: cashAccountId, debit: 0, credit: 4_000 },
        ],
      });
      trackedEntryIds.push(belowThresholdDraft.entry.id);

      const belowThresholdPosted = await journalEntriesService.post(belowThresholdDraft.entry.id, {
        actor_id: E2E_ACCOUNTANT_ID,
        actor_role: CompanyRole.Accountant,
      });
      expect(belowThresholdPosted.entry.status).toBe(JournalEntryStatus.Posted);
      await assertStatusChangeAudit(
        belowThresholdDraft.entry.id,
        JournalEntryStatus.Draft,
        JournalEntryStatus.Posted,
        'Stage 5 — below-threshold post audit',
      );
      await assertTrialBalanced('Stage 5 — below-threshold manual entry posted');

      // Stage 4/5/9 — Manual entry above approval threshold
      const aboveThresholdDraft = await journalEntriesService.create({
        company_id: E2E_COMPANY_ID,
        period_id: janPeriodId,
        entry_date: `${fiscalYear}-01-12`,
        narration: 'E2E above-threshold expense',
        created_by: E2E_ACCOUNTANT_ID,
        lines: [
          { line_number: 1, account_id: expenseAccountId, debit: APPROVAL_THRESHOLD, credit: 0 },
          { line_number: 2, account_id: cashAccountId, debit: 0, credit: APPROVAL_THRESHOLD },
        ],
      });
      trackedEntryIds.push(aboveThresholdDraft.entry.id);

      const pending = await journalEntriesService.post(aboveThresholdDraft.entry.id, {
        actor_id: E2E_ACCOUNTANT_ID,
        actor_role: CompanyRole.Accountant,
      });
      expect(pending.entry.status).toBe(JournalEntryStatus.PendingApproval);
      await assertStatusChangeAudit(
        aboveThresholdDraft.entry.id,
        JournalEntryStatus.Draft,
        JournalEntryStatus.PendingApproval,
        'Stage 9 — submit for approval audit',
      );
      await assertTrialBalanced('Stage 9 — above-threshold entry pending approval (still unposted)');

      const approved = await journalEntriesService.approve(pending.entry.id, {
        actor_id: E2E_OWNER_ID,
        actor_role: CompanyRole.Owner,
      });
      expect(approved.entry.status).toBe(JournalEntryStatus.Posted);
      expect(approved.entry.approved_by).toBe(E2E_OWNER_ID);
      await assertStatusChangeAudit(
        aboveThresholdDraft.entry.id,
        JournalEntryStatus.PendingApproval,
        JournalEntryStatus.Posted,
        'Stage 9 — Owner approve audit',
        (row) => {
          expect(row.new_data?.approved_by).toBe(E2E_OWNER_ID);
          expect(row.new_data?.approved_at).toBeTruthy();
        },
      );
      await assertTrialBalanced('Stage 9 — above-threshold entry approved and posted');

      // Stage 9 rejection path — separate above-threshold entry (does not affect ledger)
      const rejectDraft = await journalEntriesService.create({
        company_id: E2E_COMPANY_ID,
        period_id: janPeriodId,
        entry_date: `${fiscalYear}-01-13`,
        narration: 'E2E above-threshold rejection probe',
        created_by: E2E_ACCOUNTANT_ID,
        lines: [
          { line_number: 1, account_id: expenseAccountId, debit: APPROVAL_THRESHOLD, credit: 0 },
          { line_number: 2, account_id: cashAccountId, debit: 0, credit: APPROVAL_THRESHOLD },
        ],
      });
      trackedEntryIds.push(rejectDraft.entry.id);

      const rejectPending = await journalEntriesService.post(rejectDraft.entry.id, {
        actor_id: E2E_ACCOUNTANT_ID,
        actor_role: CompanyRole.Accountant,
      });
      expect(rejectPending.entry.status).toBe(JournalEntryStatus.PendingApproval);

      const rejected = await journalEntriesService.reject(rejectPending.entry.id, {
        actor_id: E2E_OWNER_ID,
        actor_role: CompanyRole.Owner,
        rejection_reason: 'E2E rejection — documentation incomplete',
      });
      expect(rejected.entry.status).toBe(JournalEntryStatus.Rejected);
      expect(rejected.entry.rejection_reason).toBe('E2E rejection — documentation incomplete');
      await assertStatusChangeAudit(
        rejectDraft.entry.id,
        JournalEntryStatus.PendingApproval,
        JournalEntryStatus.Rejected,
        'Stage 9 — Owner reject audit',
        (row) => {
          expect(row.new_data?.rejection_reason).toBe(
            'E2E rejection — documentation incomplete',
          );
          expect(row.new_data?.rejected_by).toBe(E2E_OWNER_ID);
        },
      );
      await assertTrialBalanced('Stage 9 — rejected entry left ledger unchanged');

      // P&L activity for year-end close
      const revenueDraft = await journalEntriesService.create({
        company_id: E2E_COMPANY_ID,
        period_id: janPeriodId,
        entry_date: `${fiscalYear}-01-20`,
        narration: 'E2E revenue for year-end close',
        created_by: E2E_OWNER_ID,
        lines: [
          { line_number: 1, account_id: cashAccountId, debit: 10_000, credit: 0 },
          { line_number: 2, account_id: incomeAccountId, debit: 0, credit: 10_000 },
        ],
      });
      trackedEntryIds.push(revenueDraft.entry.id);
      const revenuePosted = await journalEntriesService.post(revenueDraft.entry.id, {
        actor_id: E2E_OWNER_ID,
        actor_role: CompanyRole.Owner,
      });
      expect(revenuePosted.entry.status).toBe(JournalEntryStatus.Posted);
      await assertTrialBalanced('Stage 5 — revenue posted for year-end P&L');

      // Stage 6 — Reverse the below-threshold entry
      const reversal = await journalEntriesService.reverse(belowThresholdDraft.entry.id, E2E_OWNER_ID);
      trackedEntryIds.push(reversal.reversal.entry.id);
      expect(reversal.reversal.entry.entry_type).toBe(JournalEntryType.Reversal);
      expect(reversal.reversal.entry.status).toBe(JournalEntryStatus.Posted);
      expect(reversal.reversal.entry.reverses_entry_id).toBe(belowThresholdDraft.entry.id);

      const originalAfterReversal = await journalEntriesService.findOne(
        belowThresholdDraft.entry.id,
      );
      expect(originalAfterReversal.entry.status).toBe(JournalEntryStatus.Reversed);
      expect(originalAfterReversal.entry.reversed_by_entry_id).toBe(reversal.reversal.entry.id);

      const originalReversalAudit = await auditLogService.find({
        company_id: E2E_COMPANY_ID,
        record_id: belowThresholdDraft.entry.id,
        table_name: 'journal_entries',
      });
      const reversalAuditRow = originalReversalAudit.find(
        (row) => row.action === AuditAction.Reversal,
      );
      expect(reversalAuditRow).toBeDefined();
      expect(reversalAuditRow?.old_data?.status).toBe(JournalEntryStatus.Posted);
      expect(reversalAuditRow?.new_data?.status).toBe(JournalEntryStatus.Reversed);
      // eslint-disable-next-line no-console
      console.log('[AUDIT OK] Stage 6 — reversal row logged on original entry');

      await assertTrialBalanced('Stage 6 — reversal posted in next open period');

      await expect(
        journalEntriesService.reverse(belowThresholdDraft.entry.id, E2E_OWNER_ID),
      ).rejects.toThrow(BadRequestException);
      await assertTrialBalanced('Stage 6 — double reversal blocked, ledger unchanged');

      // Stage 8 — Recurring template generate + auto-post
      const recurringTemplate = await recurringService.create({
        company_id: E2E_COMPANY_ID,
        template_name: `E2E depreciation FY${fiscalYear}`,
        narration_template: 'E2E recurring depreciation',
        frequency: RecurrenceFrequency.Monthly,
        start_date: `${fiscalYear}-02-01`,
        next_run_date: `${fiscalYear}-02-01`,
        auto_post: true,
        created_by: E2E_OWNER_ID,
        lines: [
          { line_number: 1, account_id: expenseAccountId, debit: 500, credit: 0 },
          { line_number: 2, account_id: cashAccountId, debit: 0, credit: 500 },
        ],
      });

      const recurringResult = await recurringService.generateTemplate(recurringTemplate.template.id);
      expect(recurringResult.posted).toBe(true);
      expect(recurringResult.journal_entry?.entry.status).toBe(JournalEntryStatus.Posted);
      if (recurringResult.journal_entry) {
        trackedEntryIds.push(recurringResult.journal_entry.entry.id);
      }
      await assertTrialBalanced('Stage 8 — recurring template auto-posted');

      // Stage 10 — Soft-close January, block posting, then Owner override
      await accountingPeriodsService.softClose(janPeriodId, { closed_by: E2E_OWNER_ID });

      const blockedDraft = await journalEntriesService.create({
        company_id: E2E_COMPANY_ID,
        period_id: janPeriodId,
        entry_date: `${fiscalYear}-01-25`,
        narration: 'E2E soft-closed period blocked post',
        created_by: E2E_ACCOUNTANT_ID,
        lines: [
          { line_number: 1, account_id: expenseAccountId, debit: 100, credit: 0 },
          { line_number: 2, account_id: cashAccountId, debit: 0, credit: 100 },
        ],
      });
      trackedEntryIds.push(blockedDraft.entry.id);

      await expect(
        journalEntriesService.post(blockedDraft.entry.id, {
          actor_id: E2E_ACCOUNTANT_ID,
          actor_role: CompanyRole.Accountant,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        journalEntriesService.post(blockedDraft.entry.id, {
          actor_id: E2E_ACCOUNTANT_ID,
          actor_role: CompanyRole.Accountant,
          soft_closed_override_reason: 'Not owner',
        }),
      ).rejects.toThrow(ForbiddenException);

      const overridePosted = await journalEntriesService.post(blockedDraft.entry.id, {
        actor_id: E2E_OWNER_ID,
        actor_role: CompanyRole.Owner,
        soft_closed_override_reason: 'E2E prior-period correction after soft-close',
      });
      expect(overridePosted.entry.status).toBe(JournalEntryStatus.Posted);
      await assertTrialBalanced('Stage 10 — soft-closed override post succeeded');

      // Stage 11 — Year-end closing
      const plBeforeClose = await journalRepository.getProfitAndLossBalancesForFiscalYear(
        E2E_COMPANY_ID,
        fiscalYear,
      );
      expect(plBeforeClose.length).toBeGreaterThan(0);

      const yearEndClose = await journalEntriesService.runYearEndClosing({
        company_id: E2E_COMPANY_ID,
        fiscal_year: fiscalYear,
        entry_date: `${fiscalYear}-12-31`,
        created_by: E2E_OWNER_ID,
      });
      trackedEntryIds.push(yearEndClose.entry.id);
      expect(yearEndClose.entry.entry_type).toBe(JournalEntryType.YearEndClosing);
      expect(yearEndClose.entry.status).toBe(JournalEntryStatus.Posted);

      const plAfterClose = await journalRepository.getProfitAndLossBalancesForFiscalYear(
        E2E_COMPANY_ID,
        fiscalYear,
      );
      expect(plAfterClose).toHaveLength(0);

      const closingDebits = yearEndClose.lines.reduce((sum, line) => sum + Number(line.debit), 0);
      const closingCredits = yearEndClose.lines.reduce((sum, line) => sum + Number(line.credit), 0);
      expect(closingDebits).toBeCloseTo(closingCredits, 2);
      await assertTrialBalanced('Stage 11 — year-end closing posted');

      // Stage 12 — Audit trail covers the lifecycle
      const openingAudit = await auditLogService.find({
        company_id: E2E_COMPANY_ID,
        record_id: openingBalance.entry.id,
        table_name: 'journal_entries',
      });
      expect(openingAudit.some((row) => row.action === AuditAction.Insert)).toBe(true);

      const belowAudit = await auditLogService.find({
        company_id: E2E_COMPANY_ID,
        record_id: belowThresholdDraft.entry.id,
        table_name: 'journal_entries',
      });
      expect(belowAudit.some((row) => row.action === AuditAction.Insert)).toBe(true);
      expect(belowAudit.some((row) => row.action === AuditAction.StatusChange)).toBe(true);
      expect(belowAudit.some((row) => row.action === AuditAction.Reversal)).toBe(true);

      const reversalAudit = await auditLogService.find({
        company_id: E2E_COMPANY_ID,
        record_id: reversal.reversal.entry.id,
        table_name: 'journal_entries',
      });
      expect(reversalAudit.some((row) => row.new_data?.entry_type === JournalEntryType.Reversal)).toBe(
        true,
      );

      const yearEndAudit = await auditLogService.find({
        company_id: E2E_COMPANY_ID,
        record_id: yearEndClose.entry.id,
        table_name: 'journal_entries',
      });
      expect(
        yearEndAudit.some((row) => row.new_data?.entry_type === JournalEntryType.YearEndClosing),
      ).toBe(true);

      const companyAudit = await auditLogService.find({
        company_id: E2E_COMPANY_ID,
        table_name: 'journal_entries',
        actor_id: E2E_OWNER_ID,
      });
      expect(companyAudit.length).toBeGreaterThanOrEqual(4);
      await assertTrialBalanced('Stage 12 — audit trail verified, ledger still balanced');
    });
  },
);
