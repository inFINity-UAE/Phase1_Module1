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
import { JOURNAL_ENTRIES_REPOSITORY } from './journal-entries.repository';
import { SupabaseJournalEntriesRepository } from './journal-entries.repository.supabase';
import { JournalEntriesService } from './journal-entries.service';
import { CreateYearEndClosingDto } from './dto/create-year-end-closing.dto';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000002';
const FISCAL_YEAR = 2026;

(hasSupabase ? describe : describe.skip)(
  'JournalEntriesService year-end closing (Supabase integration)',
  () => {
    let service: JournalEntriesService;
    let repository: SupabaseJournalEntriesRepository;
    let supabase: SupabaseService;
    const createdEntryIds: string[] = [];
    let incomeAccountId = '';
    let expenseAccountId = '';
    let cashAccountId = '';
    let retainedEarningsId = '';
    let closingPeriodId = '';
    let yearEndAlreadyClosed = false;

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, AccountingPeriodsModule],
        providers: [
          JournalEntriesService,
          {
            provide: JOURNAL_ENTRIES_REPOSITORY,
            useClass: SupabaseJournalEntriesRepository,
          },
        ],
      }).compile();

      service = module.get(JournalEntriesService);
      repository = module.get(JOURNAL_ENTRIES_REPOSITORY);
      supabase = module.get(SupabaseService);

      const { data: accounts, error: accountsError } = await supabase.client
        .from('accounts')
        .select('id, account_number, category')
        .eq('company_id', COMPANY_ID)
        .in('account_number', ['4010', '5010', '1011', '3100']);
      if (accountsError || !accounts) {
        throw accountsError ?? new Error('Required accounts not found');
      }

      for (const account of accounts) {
        if (account.account_number === '4010') {
          incomeAccountId = account.id;
        } else if (account.account_number === '5010') {
          expenseAccountId = account.id;
        } else if (account.account_number === '1011') {
          cashAccountId = account.id;
        } else if (account.account_number === '3100') {
          retainedEarningsId = account.id;
        }
      }

      const { data: period, error: periodError } = await supabase.client
        .from('accounting_periods')
        .select('id')
        .eq('company_id', COMPANY_ID)
        .eq('fiscal_year', FISCAL_YEAR)
        .order('period_end', { ascending: false })
        .limit(1)
        .single();
      if (periodError || !period) {
        throw periodError ?? new Error('Closing period not found');
      }
      closingPeriodId = period.id;

      yearEndAlreadyClosed = await repository.hasYearEndClosingForFiscalYear(
        COMPANY_ID,
        FISCAL_YEAR,
      );
    });

    afterAll(async () => {
      for (const entryId of createdEntryIds.reverse()) {
        await supabase.client.from('journal_lines').delete().eq('journal_entry_id', entryId);
        await supabase.client.from('journal_entries').delete().eq('id', entryId);
      }
    });

    async function nextEntryNumber(): Promise<number> {
      return (await repository.getNextEntryNumber(COMPANY_ID)) + createdEntryIds.length;
    }

    async function insertPostedPlEntry(
      incomeAmount: number,
      expenseAmount: number,
      narration: string,
    ): Promise<string> {
      const entryNumber = await nextEntryNumber();
      const postedAt = new Date().toISOString();

      const { data: entry, error: entryError } = await supabase.client
        .from('journal_entries')
        .insert({
          company_id: COMPANY_ID,
          entry_number: entryNumber,
          period_id: closingPeriodId,
          entry_date: '2026-02-15',
          entry_type: JournalEntryType.Manual,
          status: JournalEntryStatus.Posted,
          narration,
          created_by: USER_ID,
          posted_at: postedAt,
        })
        .select('id')
        .single();

      if (entryError || !entry) {
        throw entryError ?? new Error('Failed to insert P&L entry');
      }

      createdEntryIds.push(entry.id);

      const { error: linesError } = await supabase.client.from('journal_lines').insert([
        {
          journal_entry_id: entry.id,
          line_number: 1,
          account_id: cashAccountId,
          debit: incomeAmount - expenseAmount,
          credit: 0,
        },
        {
          journal_entry_id: entry.id,
          line_number: 2,
          account_id: expenseAccountId,
          debit: expenseAmount,
          credit: 0,
        },
        {
          journal_entry_id: entry.id,
          line_number: 3,
          account_id: incomeAccountId,
          debit: 0,
          credit: incomeAmount,
        },
      ]);

      if (linesError) {
        throw linesError;
      }

      return entry.id;
    }

    async function getAccountBalance(accountId: string): Promise<number> {
      const row = await repository.getAccountTrialBalance(COMPANY_ID, accountId);
      return row?.balance ?? 0;
    }

    it(
      'year-end close zeroes income/expense, posts net to Retained Earnings, and leaves balance-sheet unchanged',
      async () => {
        if (yearEndAlreadyClosed) {
          return;
        }
      const incomeBefore = await getAccountBalance(incomeAccountId);
      const expenseBefore = await getAccountBalance(expenseAccountId);
      const cashBefore = await getAccountBalance(cashAccountId);
      const reBefore = await getAccountBalance(retainedEarningsId);

      await insertPostedPlEntry(1000, 600, 'Integration P&L activity for year-end close');

      const incomeAfterPl = await getAccountBalance(incomeAccountId);
      const expenseAfterPl = await getAccountBalance(expenseAccountId);
      expect(incomeAfterPl).toBe(incomeBefore + 1000);
      expect(expenseAfterPl).toBe(expenseBefore + 600);

      const dto: CreateYearEndClosingDto = {
        company_id: COMPANY_ID,
        fiscal_year: FISCAL_YEAR,
        created_by: USER_ID,
      };

      const result = await service.runYearEndClosing(dto);
      createdEntryIds.push(result.entry.id);

      expect(result.entry.entry_type).toBe(JournalEntryType.YearEndClosing);
      expect(result.entry.status).toBe(JournalEntryStatus.Posted);

      const totalDebit = result.lines.reduce((sum, line) => sum + Number(line.debit), 0);
      const totalCredit = result.lines.reduce((sum, line) => sum + Number(line.credit), 0);
      expect(totalDebit).toBeCloseTo(totalCredit, 2);

      expect(await getAccountBalance(incomeAccountId)).toBeCloseTo(0, 2);
      expect(await getAccountBalance(expenseAccountId)).toBeCloseTo(0, 2);
      expect(await getAccountBalance(cashAccountId)).toBeCloseTo(cashBefore + 400, 2);
      expect(await getAccountBalance(retainedEarningsId)).toBeCloseTo(reBefore + 400, 2);
      },
    );

    it('attempting year-end close a second time is rejected with no new entry', async () => {
      if (!yearEndAlreadyClosed) {
        const dto: CreateYearEndClosingDto = {
          company_id: COMPANY_ID,
          fiscal_year: FISCAL_YEAR,
          created_by: USER_ID,
        };
        const firstClose = await service.runYearEndClosing(dto);
        createdEntryIds.push(firstClose.entry.id);
        yearEndAlreadyClosed = true;
      }
      const dto: CreateYearEndClosingDto = {
        company_id: COMPANY_ID,
        fiscal_year: FISCAL_YEAR,
        created_by: USER_ID,
      };

      const incomeBefore = await getAccountBalance(incomeAccountId);
      const reBefore = await getAccountBalance(retainedEarningsId);
      const entryCountBefore = (
        await supabase.client
          .from('journal_entries')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', COMPANY_ID)
          .eq('entry_type', JournalEntryType.YearEndClosing)
      ).count;

      await expect(service.runYearEndClosing(dto)).rejects.toThrow(BadRequestException);
      await expect(service.runYearEndClosing(dto)).rejects.toThrow(
        `A year-end closing entry already exists for fiscal year ${FISCAL_YEAR}`,
      );

      const entryCountAfter = (
        await supabase.client
          .from('journal_entries')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', COMPANY_ID)
          .eq('entry_type', JournalEntryType.YearEndClosing)
      ).count;

      expect(entryCountAfter).toBe(entryCountBefore);
      expect(await getAccountBalance(incomeAccountId)).toBeCloseTo(incomeBefore, 2);
      expect(await getAccountBalance(retainedEarningsId)).toBeCloseTo(reBefore, 2);
    });
  },
);
