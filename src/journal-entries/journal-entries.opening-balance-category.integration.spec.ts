import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import { JournalEntriesModule } from './journal-entries.module';
import { JournalEntriesService } from './journal-entries.service';
import {
  INTEGRATION_USER_ID,
  mintFreshIntegrationCompany,
} from '../test/integration-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const USER_ID = INTEGRATION_USER_ID;
const FISCAL_YEAR = 2026;

(hasSupabase ? describe : describe.skip)(
  'Opening balance account category guard (decision #57)',
  () => {
    jest.setTimeout(180_000);

    let service: JournalEntriesService;
    let supabase: SupabaseService;

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, JournalEntriesModule],
      }).compile();

      service = module.get(JournalEntriesService);
      supabase = module.get(SupabaseService);
    }, 120_000);

    async function accountId(company: string, accountNumber: string): Promise<string> {
      const { data, error } = await supabase.client
        .from('accounts')
        .select('id')
        .eq('company_id', company)
        .eq('account_number', accountNumber)
        .single();
      if (error || !data) {
        throw error ?? new Error(`Account ${accountNumber} not found`);
      }
      return data.id as string;
    }

    async function countOpeningBalanceArtifacts(company: string): Promise<{
      entries: number;
      lines: number;
    }> {
      const { data: entries, error: entriesError } = await supabase.client
        .from('journal_entries')
        .select('id')
        .eq('company_id', company)
        .eq('entry_type', JournalEntryType.OpeningBalance);

      if (entriesError) {
        throw entriesError;
      }

      const entryIds = (entries ?? []).map((row) => row.id as string);
      if (entryIds.length === 0) {
        return { entries: 0, lines: 0 };
      }

      const { count, error: linesError } = await supabase.client
        .from('journal_lines')
        .select('id', { count: 'exact', head: true })
        .in('journal_entry_id', entryIds);

      if (linesError) {
        throw linesError;
      }

      return { entries: entryIds.length, lines: count ?? 0 };
    }

    it('rejects opening balance with an income account line — no rows persisted', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'Opening balance category income',
      );
      const bank = await accountId(companyId, '1020');
      const income = await accountId(companyId, '4000');
      const before = await countOpeningBalanceArtifacts(companyId);

      await expect(
        service.createOpeningBalance(
          {
            company_id: companyId,
            fiscal_year: FISCAL_YEAR,
            entry_date: '2026-01-01',
            narration: 'Invalid OB with income line',
            lines: [
              { line_number: 1, account_id: bank, debit: 1000, credit: 0 },
              { line_number: 2, account_id: income, debit: 0, credit: 1000 },
            ],
          },
          USER_ID,
        ),
      ).rejects.toThrow(/asset, liability, or equity accounts/i);

      const after = await countOpeningBalanceArtifacts(companyId);
      expect(after.entries).toBe(before.entries);
      expect(after.lines).toBe(before.lines);
    });

    it('rejects opening balance with an expense account line — no rows persisted', async () => {
      const companyId = await mintFreshIntegrationCompany(
        supabase,
        'Opening balance category expense',
      );
      const bank = await accountId(companyId, '1020');
      const expense = await accountId(companyId, '5100');

      await expect(
        service.createOpeningBalance(
          {
            company_id: companyId,
            fiscal_year: FISCAL_YEAR,
            entry_date: '2026-01-01',
            narration: 'Invalid OB with expense line',
            lines: [
              { line_number: 1, account_id: bank, debit: 500, credit: 0 },
              { line_number: 2, account_id: expense, debit: 0, credit: 500 },
            ],
          },
          USER_ID,
        ),
      ).rejects.toThrow(/asset, liability, or equity accounts/i);

      const after = await countOpeningBalanceArtifacts(companyId);
      expect(after.entries).toBe(0);
      expect(after.lines).toBe(0);
    });
  },
);
