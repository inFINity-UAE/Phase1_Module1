import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import { CompanyRole } from '../common/enums/company-role.enum';
import {
  ensureAuthUser,
  ensureCompanyMember,
  testUserEmail,
  testUserPassword,
} from '../test/company-members.setup';
import { INTEGRATION_USER_ID } from '../test/integration-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

/**
 * [feature-spec.md decision #29] companies RLS is membership-based via
 * company_members / auth.uid() — not app.current_company_id. Proves a
 * signed-in authenticated client cannot see a company they do not belong to.
 * Pattern mirrors reverse.integration's anon-key client probe (decision #10).
 */
(hasSupabase ? describe : describe.skip)(
  'companies RLS membership isolation (Supabase integration)',
  () => {
    jest.setTimeout(120_000);

    let supabase: SupabaseService;
    let memberCompanyId = '';
    let otherCompanyId = '';

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule],
      }).compile();
      supabase = module.get(SupabaseService);

      await ensureAuthUser(
        supabase,
        INTEGRATION_USER_ID,
        testUserEmail(INTEGRATION_USER_ID),
      );

      memberCompanyId = randomUUID();
      otherCompanyId = randomUUID();

      for (const [id, name] of [
        [memberCompanyId, `RLS member company ${memberCompanyId}`],
        [otherCompanyId, `RLS other company ${otherCompanyId}`],
      ] as const) {
        const { error } = await supabase.client.from('companies').insert({
          id,
          legal_name: name,
          base_currency: 'AED',
          is_free_zone_entity: false,
          fiscal_year_start_month: 1,
        });
        if (error) {
          throw error;
        }
      }

      await ensureCompanyMember(
        supabase,
        memberCompanyId,
        INTEGRATION_USER_ID,
        CompanyRole.Owner,
        testUserEmail(INTEGRATION_USER_ID),
      );
    }, 120000);

    it('anon cannot select companies (no table grant — decision #10)', async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      expect(url).toBeTruthy();
      expect(publishableKey).toBeTruthy();

      const anonClient = createClient(url!, publishableKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await anonClient.from('companies').select('id').limit(5);

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.code).toBe('42501');
    });

    it('authenticated user sees only companies they belong to', async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      expect(url).toBeTruthy();
      expect(publishableKey).toBeTruthy();

      const userClient = createClient(url!, publishableKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { error: loginError } = await userClient.auth.signInWithPassword({
        email: testUserEmail(INTEGRATION_USER_ID),
        password: testUserPassword(),
      });
      if (loginError) {
        throw loginError;
      }

      const { data, error } = await userClient
        .from('companies')
        .select('id')
        .in('id', [memberCompanyId, otherCompanyId]);

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      const ids = (data ?? []).map((row) => row.id as string);
      expect(ids).toContain(memberCompanyId);
      expect(ids).not.toContain(otherCompanyId);
    });

    it('service_role still sees all companies (RLS bypass — backend unchanged)', async () => {
      const { data, error } = await supabase.client
        .from('companies')
        .select('id')
        .in('id', [memberCompanyId, otherCompanyId]);

      expect(error).toBeNull();
      const ids = (data ?? []).map((row) => row.id as string);
      expect(ids).toEqual(expect.arrayContaining([memberCompanyId, otherCompanyId]));
    });
  },
);
