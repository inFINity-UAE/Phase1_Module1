import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { PeriodStatus } from '../common/enums/period-status.enum';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import {
  ensurePostIntegrationCompanyReady,
  INTEGRATION_USER_ID,
} from '../test/integration-company.setup';
import { AccountingPeriodsModule } from './accounting-periods.module';
import { AccountingPeriodsService } from './accounting-periods.service';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

(hasSupabase ? describe : describe.skip)(
  'AccountingPeriodsService (Supabase integration)',
  () => {
    jest.setTimeout(180_000);

    let service: AccountingPeriodsService;
    let supabase: SupabaseService;
    let companyId = '';
    const createdPeriodIds: string[] = [];
    const createdEntryIds: string[] = [];

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, AccountingPeriodsModule],
      }).compile();

      service = module.get(AccountingPeriodsService);
      supabase = module.get(SupabaseService);
      companyId = await ensurePostIntegrationCompanyReady(supabase);
    }, 120000);

    afterAll(async () => {
      // Posted entries cannot be deleted (prevent_posted_entry_deletion) — leave them
      // on the disposable fresh company (decision #19 UUID rotation).
      for (const entryId of createdEntryIds.reverse()) {
        await supabase.client.from('journal_lines').delete().eq('journal_entry_id', entryId);
        await supabase.client
          .from('journal_entries')
          .delete()
          .eq('id', entryId)
          .neq('status', JournalEntryStatus.Posted);
      }
      for (const periodId of createdPeriodIds.reverse()) {
        await supabase.client.from('accounting_periods').delete().eq('id', periodId);
      }
    });

    it('creates a period and lists it scoped to the company', async () => {
      const created = await service.create({
        company_id: companyId,
        period_start: '2090-01-01',
        period_end: '2090-01-31',
        fiscal_year: 2090,
      });
      createdPeriodIds.push(created.id);

      expect(created.status).toBe(PeriodStatus.Open);
      expect(created.company_id).toBe(companyId);

      const listed = await service.findAll(companyId);
      expect(listed.some((p) => p.id === created.id)).toBe(true);

      const otherCompanyPeriods = await service.findAll(
        '00000000-0000-0000-0000-000000000002',
      );
      expect(otherCompanyPeriods.some((p) => p.id === created.id)).toBe(false);
    });

    it('rejects an overlapping period for the same company', async () => {
      const base = await service.create({
        company_id: companyId,
        period_start: '2091-01-01',
        period_end: '2091-01-31',
        fiscal_year: 2091,
      });
      createdPeriodIds.push(base.id);

      await expect(
        service.create({
          company_id: companyId,
          period_start: '2091-01-15',
          period_end: '2091-02-15',
          fiscal_year: 2091,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('updates editable fields on an unused open period', async () => {
      const created = await service.create({
        company_id: companyId,
        period_start: '2092-01-01',
        period_end: '2092-01-31',
        fiscal_year: 2092,
      });
      createdPeriodIds.push(created.id);

      const updated = await service.update(created.id, { fiscal_year: 2093 });
      expect(updated.fiscal_year).toBe(2093);
    });

    it('rejects update when the period has posted journal activity', async () => {
      const created = await service.create({
        company_id: companyId,
        period_start: '2093-01-01',
        period_end: '2093-01-31',
        fiscal_year: 2093,
      });
      createdPeriodIds.push(created.id);

      const { data: accounts } = await supabase.client
        .from('accounts')
        .select('id')
        .eq('company_id', companyId)
        .eq('category', 'asset')
        .limit(2);
      if (!accounts || accounts.length < 2) {
        throw new Error('Need two asset accounts');
      }

      const { data: maxRow } = await supabase.client
        .from('journal_entries')
        .select('entry_number')
        .eq('company_id', companyId)
        .order('entry_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      const entryNumber = (maxRow?.entry_number ?? 0) + 1;

      const { data: entry, error: entryError } = await supabase.client
        .from('journal_entries')
        .insert({
          company_id: companyId,
          entry_number: entryNumber,
          period_id: created.id,
          entry_date: '2093-01-15',
          entry_type: JournalEntryType.Manual,
          status: JournalEntryStatus.Draft,
          narration: 'period update posted-activity probe',
          created_by: INTEGRATION_USER_ID,
        })
        .select('id')
        .single();
      if (entryError || !entry) {
        throw entryError ?? new Error('entry insert failed');
      }
      createdEntryIds.push(entry.id);

      const { error: linesError } = await supabase.client.from('journal_lines').insert([
        {
          journal_entry_id: entry.id,
          line_number: 1,
          account_id: accounts[0].id,
          debit: 10,
          credit: 0,
        },
        {
          journal_entry_id: entry.id,
          line_number: 2,
          account_id: accounts[1].id,
          debit: 0,
          credit: 10,
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

      await expect(
        service.update(created.id, { period_end: '2093-01-30' }),
      ).rejects.toThrow(ConflictException);
    });
  },
);
