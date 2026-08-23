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
  POST_INTEGRATION_COMPANY_ID,
} from '../test/integration-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const COMPANY_ID = POST_INTEGRATION_COMPANY_ID;
const USER_ID = INTEGRATION_USER_ID;

(hasSupabase ? describe : describe.skip)(
  'JournalEntriesService posting (Supabase integration)',
  () => {
    let service: JournalEntriesService;
    let repository: SupabaseJournalEntriesRepository;
    let supabase: SupabaseService;
    const createdEntryIds: string[] = [];

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, AccountingPeriodsModule, JournalEntriesModule],
      }).compile();

      service = module.get(JournalEntriesService);
      repository = module.get(JOURNAL_ENTRIES_REPOSITORY);
      supabase = module.get(SupabaseService);

      await ensurePostIntegrationCompanyReady(supabase);
    }, 120000);

    afterAll(async () => {
      for (const entryId of createdEntryIds.reverse()) {
        await supabase.client.from('journal_lines').delete().eq('journal_entry_id', entryId);
        await supabase.client.from('journal_entries').delete().eq('id', entryId);
      }
    });

    async function nextEntryNumber(): Promise<number> {
      return repository.getNextEntryNumber(COMPANY_ID);
    }

    async function getPeriodId(): Promise<string> {
      const { data, error } = await supabase.client
        .from('accounting_periods')
        .select('id')
        .eq('company_id', COMPANY_ID)
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
        .eq('company_id', COMPANY_ID)
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
      const periodId = await getPeriodId();
      const [accA, accB] = await getTwoAssetAccounts();
      const entryNumber = await nextEntryNumber();
      const postedAt = new Date().toISOString();

      const { data: entry, error: entryError } = await supabase.client
        .from('journal_entries')
        .insert({
          company_id: COMPANY_ID,
          entry_number: entryNumber,
          period_id: periodId,
          entry_date: '2026-01-15',
          entry_type: JournalEntryType.Manual,
          status: JournalEntryStatus.Posted,
          narration,
          created_by: USER_ID,
          posted_at: postedAt,
        })
        .select('id')
        .single();

      if (entryError || !entry) {
        throw entryError ?? new Error('Failed to insert posted entry');
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

    it('blocks deleting a line on a posted journal entry (DB trigger)', async () => {
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

    it('[Rules §3.1] v_trial_balance total debits equal total credits after balanced posted entries', async () => {
      const before = await repository.getTrialBalanceTotals(COMPANY_ID);

      await insertPostedBalancedEntry(100, 'integration TB entry 1');
      await insertPostedBalancedEntry(200, 'integration TB entry 2');
      await insertPostedBalancedEntry(300, 'integration TB entry 3');

      const after = await repository.getTrialBalanceTotals(COMPANY_ID);
      const debitDelta = after.total_debit - before.total_debit;
      const creditDelta = after.total_credit - before.total_credit;

      expect(debitDelta).toBe(600);
      expect(creditDelta).toBe(600);
      expect(debitDelta).toBe(creditDelta);
    });
  },
);
