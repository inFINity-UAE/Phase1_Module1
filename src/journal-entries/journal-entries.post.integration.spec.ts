import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { DatabaseModule } from '../database/database.module';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { SupabaseService } from '../database/supabase.service';
import {
  JOURNAL_ENTRIES_REPOSITORY,
} from './journal-entries.repository';
import { SupabaseJournalEntriesRepository } from './journal-entries.repository.supabase';
import { JournalEntriesModule } from './journal-entries.module';
import { JournalEntriesService } from './journal-entries.service';
import {
  ensurePostIntegrationCompanyReady,
  INTEGRATION_USER_ID,
} from '../test/integration-company.setup';
import { DEMO_COMPANY_ID, getAccountIdByNumber } from '../e2e/e2e-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const USER_ID = INTEGRATION_USER_ID;

(hasSupabase ? describe : describe.skip)(
  'JournalEntriesService posting (Supabase integration)',
  () => {
    // Match Stage 13 / advisory-lock: COA clone + live RPCs exceed Jest's 5s default.
    jest.setTimeout(180_000);

    let service: JournalEntriesService;
    let repository: SupabaseJournalEntriesRepository;
    let supabase: SupabaseService;
    /** [feature-spec.md decision #19] Fresh company UUID per run. */
    let companyId = '';
    const createdEntryIds: string[] = [];

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, AccountingPeriodsModule, JournalEntriesModule],
      }).compile();

      service = module.get(JournalEntriesService);
      repository = module.get(JOURNAL_ENTRIES_REPOSITORY);
      supabase = module.get(SupabaseService);

      companyId = await ensurePostIntegrationCompanyReady(supabase);
    }, 120000);

    afterAll(async () => {
      for (const entryId of createdEntryIds.reverse()) {
        await supabase.client.from('journal_lines').delete().eq('journal_entry_id', entryId);
        await supabase.client.from('journal_entries').delete().eq('id', entryId);
      }
    });

    async function nextEntryNumber(): Promise<number> {
      return repository.getNextEntryNumber(companyId);
    }

    async function getPeriodId(): Promise<string> {
      const { data, error } = await supabase.client
        .from('accounting_periods')
        .select('id')
        .eq('company_id', companyId)
        .limit(1)
        .single();
      if (error || !data) {
        throw error ?? new Error('No accounting period found for demo company');
      }
      return data.id;
    }

    async function getTwoAssetAccounts(): Promise<[string, string]> {
      const { data, error } = await supabase.client
        .from('accounts')
        .select('id')
        .eq('company_id', companyId)
        .eq('category', 'asset')
        .limit(2);
      if (error || !data || data.length < 2) {
        throw error ?? new Error('Need at least two asset accounts');
      }
      return [data[0].id, data[1].id];
    }

    async function insertPostedBalancedEntry(
      amount: number,
      narration: string,
    ): Promise<string> {
      // [feature-spec.md decision #28] draft → lines → post. Inserting lines
      // onto an already-posted parent is rejected by trg_prevent_posted_line_update.
      const periodId = await getPeriodId();
      const [accA, accB] = await getTwoAssetAccounts();
      const entryNumber = await nextEntryNumber();

      const { data: entry, error: entryError } = await supabase.client
        .from('journal_entries')
        .insert({
          company_id: companyId,
          entry_number: entryNumber,
          period_id: periodId,
          entry_date: '2026-01-15',
          entry_type: JournalEntryType.Manual,
          status: JournalEntryStatus.Draft,
          narration,
          created_by: USER_ID,
        })
        .select('id')
        .single();

      if (entryError || !entry) {
        throw entryError ?? new Error('Failed to insert draft entry');
      }

      createdEntryIds.push(entry.id);

      const { error: linesError } = await supabase.client.from('journal_lines').insert([
        {
          journal_entry_id: entry.id,
          line_number: 1,
          account_id: accA,
          debit: amount,
          credit: 0,
        },
        {
          journal_entry_id: entry.id,
          line_number: 2,
          account_id: accB,
          debit: 0,
          credit: amount,
        },
      ]);

      if (linesError) {
        throw linesError;
      }

      const { error: postError } = await supabase.client
        .from('journal_entries')
        .update({ status: JournalEntryStatus.Posted })
        .eq('id', entry.id)
        .eq('status', JournalEntryStatus.Draft);

      if (postError) {
        throw postError;
      }

      return entry.id;
    }

    it('blocks editing a line on a posted journal entry (DB trigger)', async () => {
      const entryId = await insertPostedBalancedEntry(75, 'integration posted immutability');
      const { data: lines, error } = await supabase.client
        .from('journal_lines')
        .select('id')
        .eq('journal_entry_id', entryId)
        .order('line_number')
        .limit(1)
        .single();

      if (error || !lines) {
        throw error ?? new Error('Line not found');
      }

      await expect(service.updateLine(lines.id, { debit: 999 })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.updateLine(lines.id, { debit: 999 })).rejects.toThrow(
        /Cannot modify lines of a posted journal entry/i,
      );
    });

    it('blocks inserting a line on a posted journal entry (DB trigger)', async () => {
      const entryId = await insertPostedBalancedEntry(85, 'integration posted insert block');
      const [, accB] = await getTwoAssetAccounts();
      const { data: existingLines, error: countError } = await supabase.client
        .from('journal_lines')
        .select('line_number')
        .eq('journal_entry_id', entryId)
        .order('line_number', { ascending: false })
        .limit(1);

      if (countError || !existingLines?.length) {
        throw countError ?? new Error('Existing lines not found');
      }

      const nextLineNumber = existingLines[0].line_number + 1;

      const { error: insertError } = await supabase.client.from('journal_lines').insert({
        journal_entry_id: entryId,
        line_number: nextLineNumber,
        account_id: accB,
        debit: 0,
        credit: 1,
      });

      expect(insertError).not.toBeNull();
      expect(insertError?.code).toBe('P0001');
      expect(insertError?.message).toMatch(/Cannot modify lines of a posted journal entry/i);
    });

    it('createLine succeeds on a draft parent without requiring balance (decision #32)', async () => {
      const periodId = await getPeriodId();
      const [accA, accB] = await getTwoAssetAccounts();
      const entryNumber = await nextEntryNumber();

      const { data: entry, error: entryError } = await supabase.client
        .from('journal_entries')
        .insert({
          company_id: companyId,
          entry_number: entryNumber,
          period_id: periodId,
          entry_date: '2026-01-15',
          entry_type: JournalEntryType.Manual,
          status: JournalEntryStatus.Draft,
          narration: 'createLine draft parent',
          created_by: USER_ID,
        })
        .select('id')
        .single();

      if (entryError || !entry) {
        throw entryError ?? new Error('Failed to insert draft entry');
      }
      createdEntryIds.push(entry.id);

      // Single debit line — intentionally unbalanced while still draft
      // (trg_enforce_journal_balance_on_post only fires on post).
      const line = await service.createLine({
        journal_entry_id: entry.id,
        line_number: 1,
        account_id: accA,
        debit: 40,
        credit: 0,
        description: 'unbalanced draft line',
      });

      expect(line.journal_entry_id).toBe(entry.id);
      expect(Number(line.debit)).toBe(40);
      expect(Number(line.credit)).toBe(0);

      const second = await service.createLine({
        journal_entry_id: entry.id,
        line_number: 2,
        account_id: accB,
        debit: 0,
        credit: 15,
      });
      expect(second.line_number).toBe(2);
    });

    it('createLine rejects INSERT on a posted parent via trg_prevent_posted_line_update (#32)', async () => {
      const entryId = await insertPostedBalancedEntry(90, 'createLine posted parent block');
      const [, accB] = await getTwoAssetAccounts();
      const { data: existingLines, error: countError } = await supabase.client
        .from('journal_lines')
        .select('line_number')
        .eq('journal_entry_id', entryId)
        .order('line_number', { ascending: false })
        .limit(1);

      if (countError || !existingLines?.length) {
        throw countError ?? new Error('Existing lines not found');
      }

      await expect(
        service.createLine({
          journal_entry_id: entryId,
          line_number: existingLines[0].line_number + 1,
          account_id: accB,
          debit: 0,
          credit: 1,
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createLine({
          journal_entry_id: entryId,
          line_number: existingLines[0].line_number + 2,
          account_id: accB,
          debit: 0,
          credit: 1,
        }),
      ).rejects.toThrow(/Cannot modify lines of a posted journal entry/i);
    });

    it('createLine rejects inactive and cross-company account_id (decision #35)', async () => {
      const periodId = await getPeriodId();
      const [accA] = await getTwoAssetAccounts();
      const inactiveId = await getAccountIdByNumber(supabase, companyId, '1050');
      const { data: foreignAccount, error: foreignError } = await supabase.client
        .from('accounts')
        .select('id')
        .eq('company_id', DEMO_COMPANY_ID)
        .eq('is_active', true)
        .limit(1)
        .single();
      if (foreignError || !foreignAccount) {
        throw foreignError ?? new Error('Need an active demo-company account');
      }

      const entryNumber = await nextEntryNumber();
      const { data: entry, error: entryError } = await supabase.client
        .from('journal_entries')
        .insert({
          company_id: companyId,
          entry_number: entryNumber,
          period_id: periodId,
          entry_date: '2026-01-15',
          entry_type: JournalEntryType.Manual,
          status: JournalEntryStatus.Draft,
          narration: 'createLine account validation',
          created_by: USER_ID,
        })
        .select('id')
        .single();
      if (entryError || !entry) {
        throw entryError ?? new Error('Failed to insert draft entry');
      }
      createdEntryIds.push(entry.id);

      await expect(
        service.createLine({
          journal_entry_id: entry.id,
          line_number: 1,
          account_id: inactiveId,
          debit: 10,
          credit: 0,
        }),
      ).rejects.toThrow(/inactive/i);

      await expect(
        service.createLine({
          journal_entry_id: entry.id,
          line_number: 1,
          account_id: foreignAccount.id,
          debit: 10,
          credit: 0,
        }),
      ).rejects.toThrow(/different company/i);

      const ok = await service.createLine({
        journal_entry_id: entry.id,
        line_number: 1,
        account_id: accA,
        debit: 10,
        credit: 0,
      });
      expect(ok.account_id).toBe(accA);
    });

    it('insertDraft rejects inactive and cross-company account_id (decision #35)', async () => {
      const periodId = await getPeriodId();
      const [accA, accB] = await getTwoAssetAccounts();
      const inactiveId = await getAccountIdByNumber(supabase, companyId, '1050');
      const { data: foreignAccount, error: foreignError } = await supabase.client
        .from('accounts')
        .select('id')
        .eq('company_id', DEMO_COMPANY_ID)
        .eq('is_active', true)
        .limit(1)
        .single();
      if (foreignError || !foreignAccount) {
        throw foreignError ?? new Error('Need an active demo-company account');
      }

      await expect(
        service.create(
          {
            company_id: companyId,
            period_id: periodId,
            entry_date: '2026-01-16',
            narration: 'draft inactive account',
            lines: [
              { line_number: 1, account_id: inactiveId, debit: 10, credit: 0 },
              { line_number: 2, account_id: accB, debit: 0, credit: 10 },
            ],
          },
          USER_ID,
        ),
      ).rejects.toThrow(/inactive/i);

      await expect(
        service.create(
          {
            company_id: companyId,
            period_id: periodId,
            entry_date: '2026-01-16',
            narration: 'draft cross-company account',
            lines: [
              { line_number: 1, account_id: foreignAccount.id, debit: 10, credit: 0 },
              { line_number: 2, account_id: accB, debit: 0, credit: 10 },
            ],
          },
          USER_ID,
        ),
      ).rejects.toThrow(/different company/i);

      const created = await service.create(
        {
          company_id: companyId,
          period_id: periodId,
          entry_date: '2026-01-16',
          narration: 'draft valid accounts',
          lines: [
            { line_number: 1, account_id: accA, debit: 10, credit: 0 },
            { line_number: 2, account_id: accB, debit: 0, credit: 10 },
          ],
        },
        USER_ID,
      );
      createdEntryIds.push(created.entry.id);
      expect(created.lines).toHaveLength(2);
    });

    it('createOpeningBalance rejects inactive and cross-company account_id (decision #39)', async () => {
      const [accA, accB] = await getTwoAssetAccounts();
      const inactiveId = await getAccountIdByNumber(supabase, companyId, '1050');
      const { data: foreignAccount, error: foreignError } = await supabase.client
        .from('accounts')
        .select('id')
        .eq('company_id', DEMO_COMPANY_ID)
        .eq('is_active', true)
        .limit(1)
        .single();
      if (foreignError || !foreignAccount) {
        throw foreignError ?? new Error('Need an active demo-company account');
      }

      await expect(
        service.createOpeningBalance(
          {
            company_id: companyId,
            fiscal_year: 2026,
            entry_date: '2026-01-01',
            narration: 'ob inactive account',
            lines: [
              { line_number: 1, account_id: inactiveId, debit: 100, credit: 0 },
              { line_number: 2, account_id: accB, debit: 0, credit: 100 },
            ],
          },
          USER_ID,
        ),
      ).rejects.toThrow(/inactive/i);

      await expect(
        service.createOpeningBalance(
          {
            company_id: companyId,
            fiscal_year: 2026,
            entry_date: '2026-01-01',
            narration: 'ob cross-company account',
            lines: [
              { line_number: 1, account_id: foreignAccount.id, debit: 100, credit: 0 },
              { line_number: 2, account_id: accA, debit: 0, credit: 100 },
            ],
          },
          USER_ID,
        ),
      ).rejects.toThrow(/different company/i);
    });

    it('updateLine rejects inactive and cross-company account_id; skips check when account_id omitted (#39)', async () => {
      const periodId = await getPeriodId();
      const [accA, accB] = await getTwoAssetAccounts();
      const inactiveId = await getAccountIdByNumber(supabase, companyId, '1050');
      const { data: foreignAccount, error: foreignError } = await supabase.client
        .from('accounts')
        .select('id')
        .eq('company_id', DEMO_COMPANY_ID)
        .eq('is_active', true)
        .limit(1)
        .single();
      if (foreignError || !foreignAccount) {
        throw foreignError ?? new Error('Need an active demo-company account');
      }

      const entryNumber = await nextEntryNumber();
      const { data: entry, error: entryError } = await supabase.client
        .from('journal_entries')
        .insert({
          company_id: companyId,
          entry_number: entryNumber,
          period_id: periodId,
          entry_date: '2026-01-17',
          entry_type: JournalEntryType.Manual,
          status: JournalEntryStatus.Draft,
          narration: 'updateLine account validation',
          created_by: USER_ID,
        })
        .select('id')
        .single();
      if (entryError || !entry) {
        throw entryError ?? new Error('Failed to insert draft entry');
      }
      createdEntryIds.push(entry.id);

      const line = await service.createLine({
        journal_entry_id: entry.id,
        line_number: 1,
        account_id: accA,
        debit: 10,
        credit: 0,
      });

      await expect(
        service.updateLine(line.id, { account_id: inactiveId }),
      ).rejects.toThrow(/inactive/i);

      await expect(
        service.updateLine(line.id, { account_id: foreignAccount.id }),
      ).rejects.toThrow(/different company/i);

      const amountOnly = await service.updateLine(line.id, { debit: 25 });
      expect(amountOnly.account_id).toBe(accA);
      expect(Number(amountOnly.debit)).toBe(25);

      const switched = await service.updateLine(line.id, { account_id: accB });
      expect(switched.account_id).toBe(accB);
    });

    it('deleteLine rejects DELETE on a posted parent via trg_prevent_posted_line_update (#34)', async () => {
      const entryId = await insertPostedBalancedEntry(80, 'integration posted delete block');
      const { data: line, error } = await supabase.client
        .from('journal_lines')
        .select('id')
        .eq('journal_entry_id', entryId)
        .order('line_number')
        .limit(1)
        .single();

      if (error || !line) {
        throw error ?? new Error('Line not found');
      }

      await expect(service.deleteLine(line.id)).rejects.toThrow(BadRequestException);
      await expect(service.deleteLine(line.id)).rejects.toThrow(
        /Cannot modify lines of a posted journal entry/i,
      );
    });

    it('deleteLine removes a line from a draft parent (decision #34)', async () => {
      const periodId = await getPeriodId();
      const [accA, accB] = await getTwoAssetAccounts();
      const entryNumber = await nextEntryNumber();

      const { data: entry, error: entryError } = await supabase.client
        .from('journal_entries')
        .insert({
          company_id: companyId,
          entry_number: entryNumber,
          period_id: periodId,
          entry_date: '2026-01-15',
          entry_type: JournalEntryType.Manual,
          status: JournalEntryStatus.Draft,
          narration: 'deleteLine draft parent',
          created_by: USER_ID,
        })
        .select('id')
        .single();

      if (entryError || !entry) {
        throw entryError ?? new Error('Failed to insert draft entry');
      }
      createdEntryIds.push(entry.id);

      const lineA = await service.createLine({
        journal_entry_id: entry.id,
        line_number: 1,
        account_id: accA,
        debit: 10,
        credit: 0,
      });
      await service.createLine({
        journal_entry_id: entry.id,
        line_number: 2,
        account_id: accB,
        debit: 0,
        credit: 10,
      });

      await expect(service.deleteLine(lineA.id)).resolves.toBeUndefined();

      const { data: remaining, error: remainingError } = await supabase.client
        .from('journal_lines')
        .select('id, line_number')
        .eq('journal_entry_id', entry.id)
        .order('line_number');

      if (remainingError) {
        throw remainingError;
      }
      expect(remaining).toHaveLength(1);
      expect(remaining![0].line_number).toBe(2);
    });

    it('[Rules §3.1] v_trial_balance total debits equal total credits after balanced posted entries', async () => {
      const before = await repository.getTrialBalanceTotals(companyId);

      await insertPostedBalancedEntry(100, 'integration TB entry 1');
      await insertPostedBalancedEntry(200, 'integration TB entry 2');
      await insertPostedBalancedEntry(300, 'integration TB entry 3');

      const after = await repository.getTrialBalanceTotals(companyId);
      const debitDelta = after.total_debit - before.total_debit;
      const creditDelta = after.total_credit - before.total_credit;

      expect(debitDelta).toBe(600);
      expect(creditDelta).toBe(600);
      expect(debitDelta).toBe(creditDelta);
    });
  },
);
