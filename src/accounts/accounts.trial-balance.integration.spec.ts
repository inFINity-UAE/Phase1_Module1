import { config } from 'dotenv';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

config({ path: resolve(__dirname, '../../.env.local') });

import {
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { AddressInfo } from 'net';
import { Test, TestingModule } from '@nestjs/testing';
import { createClient } from '@supabase/supabase-js';
import { AppModule } from '../app.module';
import { SupabaseService } from '../database/supabase.service';
import { CompanyRole } from '../common/enums/company-role.enum';
import {
  ensureAuthUser,
  ensureCompanyMember,
  testUserEmail,
  testUserPassword,
} from '../test/company-members.setup';
import {
  INTEGRATION_USER_ID,
  mintFreshIntegrationCompany,
} from '../test/integration-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

/**
 * [feature-spec.md decision #47 / §7.16 finding #8]
 * GET /accounts/:id/trial-balance — per-account v_trial_balance row.
 */
(hasSupabase ? describe : describe.skip)(
  'GET /accounts/:id/trial-balance (decision #47)',
  () => {
    jest.setTimeout(180_000);

    let app: INestApplication;
    let baseUrl: string;
    let supabase: SupabaseService;
    let accessToken = '';
    let memberCompanyId = '';
    let foreignCompanyId = '';
    let memberAccountId = '';
    let foreignAccountId = '';

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = module.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: true },
        }),
      );
      await app.init();
      await app.listen(0);
      const address = app.getHttpServer().address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;

      supabase = module.get(SupabaseService);

      await ensureAuthUser(
        supabase,
        INTEGRATION_USER_ID,
        testUserEmail(INTEGRATION_USER_ID),
      );

      memberCompanyId = await mintFreshIntegrationCompany(
        supabase,
        'Trial balance member',
      );
      foreignCompanyId = await mintFreshIntegrationCompany(
        supabase,
        'Trial balance foreign',
      );

      await supabase.client
        .from('company_members')
        .delete()
        .eq('company_id', foreignCompanyId)
        .eq('user_id', INTEGRATION_USER_ID);

      await ensureCompanyMember(
        supabase,
        memberCompanyId,
        INTEGRATION_USER_ID,
        CompanyRole.Owner,
        testUserEmail(INTEGRATION_USER_ID),
      );

      const { data: memberAccount, error: maErr } = await supabase.client
        .from('accounts')
        .select('id')
        .eq('company_id', memberCompanyId)
        .eq('account_number', '1010')
        .single();
      if (maErr || !memberAccount) {
        throw maErr ?? new Error('member account missing');
      }
      memberAccountId = memberAccount.id as string;

      const { data: foreignAccount, error: faErr } = await supabase.client
        .from('accounts')
        .select('id')
        .eq('company_id', foreignCompanyId)
        .eq('account_number', '1010')
        .single();
      if (faErr || !foreignAccount) {
        throw faErr ?? new Error('foreign account missing');
      }
      foreignAccountId = foreignAccount.id as string;

      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
      const userClient = createClient(url, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: login, error: loginError } =
        await userClient.auth.signInWithPassword({
          email: testUserEmail(INTEGRATION_USER_ID),
          password: testUserPassword(),
        });
      if (loginError || !login.session?.access_token) {
        throw loginError ?? new Error('login failed');
      }
      accessToken = login.session.access_token;
    }, 180000);

    afterAll(async () => {
      await app.close();
    });

    async function http(
      method: string,
      path: string,
    ): Promise<{ status: number; json: unknown }> {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }
      return { status: response.status, json };
    }

    it('member receives trial balance for their company account', async () => {
      const result = await http(
        'GET',
        `/accounts/${memberAccountId}/trial-balance`,
      );

      expect(result.status).toBe(200);
      expect(result.json).toMatchObject({
        account_id: memberAccountId,
        total_debit: expect.any(Number),
        total_credit: expect.any(Number),
        balance: expect.any(Number),
      });
    });

    it('non-member receives 403 for a foreign company account', async () => {
      const result = await http(
        'GET',
        `/accounts/${foreignAccountId}/trial-balance`,
      );

      expect(result.status).toBe(403);
      expect(JSON.stringify(result.json)).toMatch(/not a member/i);
    });

    it('nonexistent account_id returns 404, not a raw DB error', async () => {
      const missingId = randomUUID();
      const result = await http('GET', `/accounts/${missingId}/trial-balance`);

      expect(result.status).toBe(404);
      expect(JSON.stringify(result.json)).toMatch(/not found/i);
    });
  },
);
