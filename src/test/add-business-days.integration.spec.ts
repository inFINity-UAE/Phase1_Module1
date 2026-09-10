import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import { mintFreshIntegrationCompany } from './integration-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

/**
 * [feature-spec-1_1_D.md §4.5a / D-10, D-13, D-14 / §3.1b]
 * add_business_days — weekend + public-holiday aware date arithmetic.
 */
(hasSupabase ? describe : describe.skip)(
  'add_business_days (feature-spec-1_1_D.md §4.5a)',
  () => {
    jest.setTimeout(180_000);

    let supabase: SupabaseService;
    let companyId = '';
    const companyHolidayIds: string[] = [];

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule],
      }).compile();

      supabase = module.get(SupabaseService);
      companyId = await mintFreshIntegrationCompany(supabase, 'Add business days');
    }, 120_000);

    afterAll(async () => {
      if (companyHolidayIds.length) {
        await supabase.client.from('public_holidays').delete().in('id', companyHolidayIds);
      }
      if (companyId) {
        await supabase.client
          .from('company_settings')
          .update({ weekend_days: [6, 7] })
          .eq('company_id', companyId);
      }
    });

    async function addBusinessDays(startDate: string, n: number): Promise<string> {
      const { data, error } = await supabase.client.rpc('add_business_days', {
        p_company_id: companyId,
        p_start_date: startDate,
        p_n: n,
      });
      expect(error).toBeNull();
      return data as string;
    }

    it('skips Sat/Sun weekend when advancing across a Friday', async () => {
      // 2026-03-05 = Thursday. +1 → Fri 6th; +2 → Mon 9th (skip 7–8).
      expect(await addBusinessDays('2026-03-05', 1)).toBe('2026-03-06');
      expect(await addBusinessDays('2026-03-05', 2)).toBe('2026-03-09');
    });

    it('skips a UAE-wide public holiday (CONFIRMED Gregorian New Year)', async () => {
      // 2026-12-31 = Thursday. 2027-01-01 = Friday CONFIRMED holiday.
      // +1 business day → Mon 2027-01-04 (skip Fri holiday + Sat/Sun).
      const { data: holiday, error } = await supabase.client
        .from('public_holidays')
        .select('holiday_date, status, company_id')
        .is('company_id', null)
        .eq('holiday_date', '2027-01-01')
        .maybeSingle();
      expect(error).toBeNull();
      expect(holiday?.status).toBe('CONFIRMED');

      expect(await addBusinessDays('2026-12-31', 1)).toBe('2027-01-04');
    });

    it('skips weekend and National Day holidays in one run', async () => {
      // 2026-12-01 = Tuesday. National Day 2026-12-02 (Wed) + 2026-12-03 (Thu).
      // +3 business days: Fri 4th (#1), Mon 7th (#2), Tue 8th (#3).
      expect(await addBusinessDays('2026-12-01', 3)).toBe('2026-12-08');
    });

    it('honours company weekend_days override (Fri+Sat instead of Sat+Sun)', async () => {
      const { error: updErr } = await supabase.client
        .from('company_settings')
        .update({ weekend_days: [5, 6] })
        .eq('company_id', companyId);
      expect(updErr).toBeNull();

      // 2026-03-05 = Thursday. Weekend Fri+Sat → +1 = Sunday 8th.
      expect(await addBusinessDays('2026-03-05', 1)).toBe('2026-03-08');
      // +2 = Monday 9th.
      expect(await addBusinessDays('2026-03-05', 2)).toBe('2026-03-09');

      const { error: resetErr } = await supabase.client
        .from('company_settings')
        .update({ weekend_days: [6, 7] })
        .eq('company_id', companyId);
      expect(resetErr).toBeNull();
    });

    it('company-scoped holiday takes precedence and blocks that date (§3.1b)', async () => {
      // Ordinary Wednesday 2026-06-10 — insert company-scoped holiday.
      const { data: row, error } = await supabase.client
        .from('public_holidays')
        .insert({
          company_id: companyId,
          holiday_date: '2026-06-10',
          description: 'Company off-site (integration probe)',
          status: 'PROVISIONAL',
          source: 'integration-test',
        })
        .select('id')
        .single();
      expect(error).toBeNull();
      companyHolidayIds.push(row!.id);

      // 2026-06-09 = Tuesday. +1 skips Wed holiday → Thu 11th.
      // PROVISIONAL counts like CONFIRMED (D-14).
      expect(await addBusinessDays('2026-06-09', 1)).toBe('2026-06-11');

      const { data: isBiz, error: bizErr } = await supabase.client.rpc('is_business_day', {
        p_company_id: companyId,
        p_date: '2026-06-10',
      });
      expect(bizErr).toBeNull();
      expect(isBiz).toBe(false);
    });
  },
);
