import { config } from 'dotenv';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

config({ path: resolve(__dirname, '../../.env.local') });

import { ConflictException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createClient } from '@supabase/supabase-js';
import { AddressInfo } from 'net';
import { AppModule } from '../app.module';
import { CustomersModule } from './customers.module';
import { CustomersService } from './customers.service';
import { SupabaseService } from '../database/supabase.service';
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
import { CompanyRole } from '../common/enums/company-role.enum';
import { DatabaseModule } from '../database/database.module';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

function uniqueTrn(): string {
  return `1${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 15);
}

(hasSupabase ? describe : describe.skip)(
  'Customers (feature-spec-1.1.C.md §1.1)',
  () => {
    jest.setTimeout(180_000);

    let service: CustomersService;
    let supabase: SupabaseService;
    let companyA = '';
    let companyB = '';
    const createdCustomerIds: string[] = [];

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, CustomersModule],
      }).compile();

      service = module.get(CustomersService);
      supabase = module.get(SupabaseService);

      companyA = await mintFreshIntegrationCompany(supabase, 'Customers A');
      companyB = await mintFreshIntegrationCompany(supabase, 'Customers B');
    }, 120000);

    afterAll(async () => {
      for (const id of createdCustomerIds.reverse()) {
        await supabase.client.from('customers').delete().eq('id', id);
      }
    });

    async function createCustomer(
      companyId: string,
      name: string,
      trn?: string | null,
    ) {
      const created = await service.create({
        company_id: companyId,
        customer_name: name,
        ...(trn !== undefined ? { trn } : {}),
        email: `${randomUUID()}@example.test`,
      });
      createdCustomerIds.push(created.id);
      return created;
    }

    it('create / list / get / update happy path', async () => {
      const trn = uniqueTrn();
      const created = await createCustomer(companyA, 'Happy Path Co', trn);
      expect(created.trn).toBe(trn);
      expect(created.is_active).toBe(true);

      const listed = await service.findAll(companyA);
      expect(listed.some((c) => c.id === created.id)).toBe(true);

      const fetched = await service.findOne(created.id);
      expect(fetched.customer_name).toBe('Happy Path Co');

      const updated = await service.update(created.id, {
        customer_name: 'Happy Path Renamed',
        phone: '+971511111111',
      });
      expect(updated.customer_name).toBe('Happy Path Renamed');
      expect(updated.phone).toBe('+971511111111');
      expect(updated.trn).toBe(trn);
    });

    it('rejects duplicate TRN within the same company', async () => {
      const trn = uniqueTrn();
      await createCustomer(companyA, `Dup A ${randomUUID()}`, trn);

      await expect(
        service.create({
          company_id: companyA,
          customer_name: 'Second with same TRN',
          trn,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows the same TRN across two different companies', async () => {
      const trn = `200${Date.now()}`.slice(0, 15);
      const a = await createCustomer(companyA, `Cross A ${randomUUID()}`, trn);
      const b = await createCustomer(companyB, `Cross B ${randomUUID()}`, trn);
      expect(a.trn).toBe(trn);
      expect(b.trn).toBe(trn);
      expect(a.company_id).not.toBe(b.company_id);
    });

    it('allows multiple customers with null TRN in the same company', async () => {
      const first = await createCustomer(companyA, `No TRN 1 ${randomUUID()}`, null);
      const second = await createCustomer(companyA, `No TRN 2 ${randomUUID()}`, null);
      expect(first.trn).toBeNull();
      expect(second.trn).toBeNull();
    });

    it('deactivate sets is_active=false (soft delete)', async () => {
      const created = await createCustomer(companyA, `Deactivate ${randomUUID()}`, null);
      const deactivated = await service.deactivate(created.id);
      expect(deactivated.is_active).toBe(false);

      const refetched = await service.findOne(created.id);
      expect(refetched.is_active).toBe(false);
    });
  },
);

(hasSupabase ? describe : describe.skip)(
  'Customers cross-tenant HTTP (decision #41)',
  () => {
    jest.setTimeout(180_000);

    let app: INestApplication;
    let baseUrl: string;
    let supabase: SupabaseService;
    let accessToken = '';
    let memberCompanyId = '';
    let foreignCompanyId = '';
    let foreignCustomerId = '';

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

      memberCompanyId = await mintFreshIntegrationCompany(supabase, 'Customer member');
      foreignCompanyId = await mintFreshIntegrationCompany(supabase, 'Customer foreign');

      await supabase.client
        .from('company_members')
        .delete()
        .eq('company_id', foreignCompanyId)
        .eq('user_id', INTEGRATION_USER_ID);

      const { data: foreignCustomer, error } = await supabase.client
        .from('customers')
        .insert({
          company_id: foreignCompanyId,
          customer_name: 'Foreign customer',
          trn: null,
        })
        .select('id')
        .single();
      if (error || !foreignCustomer) {
        throw error ?? new Error('foreign customer seed failed');
      }
      foreignCustomerId = foreignCustomer.id as string;

      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
      const userClient = createClient(url, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: login, error: loginError } = await userClient.auth.signInWithPassword({
        email: testUserEmail(INTEGRATION_USER_ID),
        password: testUserPassword(),
      });
      if (loginError || !login.session?.access_token) {
        throw loginError ?? new Error('login failed');
      }
      accessToken = login.session.access_token;

      await ensureCompanyMember(
        supabase,
        memberCompanyId,
        INTEGRATION_USER_ID,
        CompanyRole.Owner,
        testUserEmail(INTEGRATION_USER_ID),
      );
    }, 180000);

    afterAll(async () => {
      await supabase.client.from('customers').delete().eq('id', foreignCustomerId);
      await app.close();
    });

    async function http(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<{ status: number; json: unknown }> {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
      };
      let payload: string | undefined;
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: payload,
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

    it('cross-tenant list spoof returns 403', async () => {
      const result = await http('GET', `/customers?company_id=${foreignCompanyId}`);
      expect(result.status).toBe(403);
    });

    it('cross-tenant get by id returns 403', async () => {
      const result = await http('GET', `/customers/${foreignCustomerId}`);
      expect(result.status).toBe(403);
    });
  },
);
