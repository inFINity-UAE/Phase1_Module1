/**
 * [feature-spec.md decision #59] Permanent Jest coverage for trigger/RPC
 * branches the 2026-08-29 integrity sweep found live but previously
 * unasserted in *.spec.ts.
 */
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseModule } from '../database/database.module';
import { AccountsModule } from '../accounts/accounts.module';
import { AccountsService } from '../accounts/accounts.service';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { SupabaseService } from '../database/supabase.service';
import { AccountCategory } from '../common/enums/account-category.enum';
import { NormalBalance } from '../common/enums/normal-balance.enum';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import {
  INTEGRATION_USER_ID,
  mintFreshIntegrationCompany,
} from './integration-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const ACTOR = INTEGRATION_USER_ID;

(hasSupabase ? describe : describe.skip)(
  'Integrity sweep regression branches (decision #59)',
  () => {
    jest.setTimeout(180_000);

    let accountsService: AccountsService;
    let journalService: JournalEntriesService;
    let supabase: SupabaseService;
    let companyId = '';
    let periodId = '';
    let cashId = '';
    let bankId = '';
    let incomeId = '';
    let expenseId = '';
    let retainedId = '';

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, AccountsModule, JournalEntriesModule],
      }).compile();

      accountsService = module.get(AccountsService);
      journalService = module.get(JournalEntriesService);
      supabase = module.get(SupabaseService);

      companyId = await mintFreshIntegrationCompany(
        supabase,
        'Integrity Sweep Regression',
      );

      const { data: period } = await supabase.client
        .from('accounting_periods')
        .select('id')
        .eq('company_id', companyId)
        .eq('period_start', '2026-01-01')
        .single();
      periodId = period!.id;

      const { data: accts } = await supabase.client
        .from('accounts')
        .select('id, account_number')
        .eq('company_id', companyId)
        .in('account_number', ['1010', '1020', '3100', '4000', '5100']);
      for (const a of accts ?? []) {
        if (a.account_number === '1010') cashId = a.id;
        if (a.account_number === '1020') bankId = a.id;
        if (a.account_number === '3100') retainedId = a.id;
        if (a.account_number === '4000') incomeId = a.id;
        if (a.account_number === '5100') expenseId = a.id;
      }
    }, 120_000);

    it('account_number/category mismatch rejects equity and income bands', async () => {
      const { error: equity } = await supabase.client.from('accounts').insert({
        company_id: companyId,
        account_number: '1500',
        account_name: 'Bad equity',
        category: AccountCategory.Equity,
        normal_balance: NormalBalance.Credit,
      });
      expect(equity?.code).toBe('P0001');
      expect(equity?.message).toMatch(/expected prefix 3/i);

      const { error: income } = await supabase.client.from('accounts').insert({
        company_id: companyId,
        account_number: '2500',
        account_name: 'Bad income',
        category: AccountCategory.Income,
        normal_balance: NormalBalance.Credit,
      });
      expect(income?.code).toBe('P0001');
      expect(income?.message).toMatch(/expected prefix 4/i);
    });

    it('prevent_account_deletion: system blocked; clean non-system allowed', async () => {
      const { error: sys } = await supabase.client
        .from('accounts')
        .delete()
        .eq('id', retainedId);
      expect(sys?.code).toBe('P0001');
      expect(sys?.message).toMatch(/System accounts cannot be deleted/i);

      const created = await accountsService.create({
        company_id: companyId,
        account_number: '1997',
        account_name: 'Sweep deletable',
        category: AccountCategory.Asset,
        normal_balance: NormalBalance.Debit,
      });
      await expect(accountsService.remove(created.id)).resolves.toBeUndefined();
    });

    it('draft journal entry hard-delete succeeds; posted raises POSTED_ENTRY_DELETE_BLOCKED', async () => {
      const draft = await journalService.create(
        {
          company_id: companyId,
          period_id: periodId,
          entry_date: '2026-01-05',
          narration: 'draft delete allow',
          lines: [
            { line_number: 1, account_id: cashId, debit: 3, credit: 0 },
            { line_number: 2, account_id: bankId, debit: 0, credit: 3 },
          ],
        },
        ACTOR,
      );
      await expect(
        journalService.deleteEntry(draft.entry.id, ACTOR),
      ).resolves.toBeUndefined();

      const posted = await journalService.create(
        {
          company_id: companyId,
          period_id: periodId,
          entry_date: '2026-01-06',
          narration: 'posted delete block',
          lines: [
            { line_number: 1, account_id: cashId, debit: 4, credit: 0 },
            { line_number: 2, account_id: bankId, debit: 0, credit: 4 },
          ],
        },
        ACTOR,
      );
      await journalService.post(posted.entry.id, ACTOR);
      await expect(
        journalService.deleteEntry(posted.entry.id, ACTOR),
      ).rejects.toThrow(/Posted journal entries cannot be deleted/i);
    });

    it('UPDATE to posted with zero lines is rejected', async () => {
      const { data: empty, error: insertErr } = await supabase.client
        .from('journal_entries')
        .insert({
          company_id: companyId,
          entry_number: await supabase.client
            .rpc('allocate_next_entry_number', { p_company_id: companyId })
            .then((r) => r.data as number),
          period_id: periodId,
          entry_date: '2026-01-07',
          entry_type: JournalEntryType.Manual,
          status: JournalEntryStatus.Draft,
          narration: 'zero lines',
          created_by: ACTOR,
        })
        .select('id')
        .single();
      expect(insertErr).toBeNull();

      const { error } = await supabase.client
        .from('journal_entries')
        .update({ status: 'posted', posted_at: new Date().toISOString() })
        .eq('id', empty!.id);
      expect(error?.code).toBe('P0001');
      expect(error?.message).toMatch(/no lines/i);
    });

    it('RPC tokens: JOURNAL_DRAFT_REQUIRES_LINES, NO_OPEN_PERIOD, NO_PERIOD, OB first-line income', async () => {
      const { error: emptyLines } = await supabase.client.rpc(
        'insert_journal_entry_draft',
        {
          p_company_id: companyId,
          p_period_id: periodId,
          p_entry_date: '2026-01-08',
          p_entry_type: 'manual',
          p_narration: 'empty',
          p_created_by: ACTOR,
          p_lines: [],
          p_reference_number: null,
          p_recurring_template_id: null,
        },
      );
      expect(emptyLines?.message).toContain('JOURNAL_DRAFT_REQUIRES_LINES');

      const { error: obFirst } = await supabase.client.rpc(
        'create_opening_balance_entry',
        {
          p_company_id: companyId,
          p_fiscal_year: 2026,
          p_entry_date: '2026-01-01',
          p_narration: 'income first line',
          p_created_by: ACTOR,
          p_lines: [
            { line_number: 1, account_id: incomeId, debit: 0, credit: 10 },
            { line_number: 2, account_id: cashId, debit: 10, credit: 0 },
          ],
          p_reference_number: null,
        },
      );
      expect(obFirst?.message).toContain('OPENING_BALANCE_INVALID_ACCOUNT_CATEGORY');

      await supabase.client
        .from('accounting_periods')
        .update({ status: 'soft_closed' })
        .eq('company_id', companyId);
      const { error: noOpen } = await supabase.client.rpc(
        'create_opening_balance_entry',
        {
          p_company_id: companyId,
          p_fiscal_year: 2026,
          p_entry_date: '2026-01-01',
          p_narration: 'no open',
          p_created_by: ACTOR,
          p_lines: [
            { line_number: 1, account_id: cashId, debit: 10, credit: 0 },
            { line_number: 2, account_id: bankId, debit: 0, credit: 10 },
          ],
          p_reference_number: null,
        },
      );
      expect(noOpen?.message).toContain('NO_OPEN_PERIOD_FOR_FISCAL_YEAR');
      await supabase.client
        .from('accounting_periods')
        .update({ status: 'open' })
        .eq('company_id', companyId);

      const { error: noPeriod } = await supabase.client.rpc(
        'create_year_end_closing_entry',
        {
          p_company_id: companyId,
          p_fiscal_year: 2099,
          p_created_by: ACTOR,
        },
      );
      expect(noPeriod?.message).toContain('NO_PERIOD_FOR_FISCAL_YEAR');
    });

    it('cannot reverse a reversal entry', async () => {
      const draft = await journalService.create(
        {
          company_id: companyId,
          period_id: periodId,
          entry_date: '2026-01-09',
          narration: 'to reverse then block',
          lines: [
            { line_number: 1, account_id: expenseId, debit: 11, credit: 0 },
            { line_number: 2, account_id: cashId, debit: 0, credit: 11 },
          ],
        },
        ACTOR,
      );
      await journalService.post(draft.entry.id, ACTOR);
      const reversed = await journalService.reverse(draft.entry.id, ACTOR);
      expect(reversed.reversal.entry.entry_type).toBe(JournalEntryType.Reversal);

      await expect(
        journalService.reverse(reversed.reversal.entry.id, ACTOR),
      ).rejects.toThrow(BadRequestException);
      await expect(
        journalService.reverse(reversed.reversal.entry.id, ACTOR),
      ).rejects.toThrow(/is a reversal entry and cannot be reversed/i);
    });
  },
);
