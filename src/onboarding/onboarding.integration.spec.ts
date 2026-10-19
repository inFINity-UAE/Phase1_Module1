import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import { testUserPassword } from '../test/company-members.setup';
import { OnboardingService } from './onboarding.service';
import { OnboardWorkspaceDto } from './dto/onboard-workspace.dto';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const body = (legal: string, customers: OnboardWorkspaceDto['customers'] = []): OnboardWorkspaceDto => ({
  legal_name: legal,
  trn: null,
  base_currency: 'AED',
  is_free_zone_entity: false,
  fiscal_year_start_month: 4,
  journal_approval_threshold: null,
  default_period_length: 'quarterly',
  allow_period_reopen: true,
  write_off_approval_threshold: 5000,
  weekend_days: [6, 7],
  vat_return_frequency: 'quarterly',
  default_emirate: 'dubai',
  customers,
});

(hasSupabase ? describe : describe.skip)('onboard_company (Supabase integration)', () => {
  jest.setTimeout(180_000);

  let supabase: SupabaseService;
  let service: OnboardingService;
  const createdUsers: string[] = [];
  const createdCompanies: string[] = [];

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [OnboardingService],
    }).compile();
    supabase = module.get(SupabaseService);
    service = module.get(OnboardingService);
  });

  afterAll(async () => {
    for (const companyId of createdCompanies) {
      await supabase.client.from('companies').delete().eq('id', companyId);
    }
    for (const userId of createdUsers) {
      await supabase.client.auth.admin.deleteUser(userId);
    }
  });

  async function user(label: string): Promise<string> {
    const id = randomUUID();
    const { error } = await supabase.client.auth.admin.createUser({
      id,
      email: `onboard-${label}-${id}@infinity.local`,
      password: testUserPassword(),
      email_confirm: true,
      user_metadata: { full_name: label, phone: '+971501112233' },
    });
    if (error) throw error;
    createdUsers.push(id);
    return id;
  }

  it('creates one company,  the template chart, bank 1020, periods, and a customer', async () => {
    const userId = await user('a');
    const created = await service.createWorkspace(userId, body('Onboard A', [{
      customer_name: 'Desert Mall',
      trn: '100234567800003',
      email: 'ap@desertmall.example',
      phone: '+971501234567',
      billing_address: 'Dubai',
      credit_limit: 1000,
    }]));
    createdCompanies.push(created.company_id);
    expect(created.role).toBe('owner');

    const again = await service.createWorkspace(userId, body('Onboard A again'));
    expect(again.company_id).toBe(created.company_id);

    const { count: companies } = await supabase.client
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .eq('id', created.company_id);
    expect(companies).toBe(1);

    const { data: settings } = await supabase.client
      .from('company_settings')
      .select('default_bank_account_id, default_period_length, fiscal_year_start_month')
      .eq('company_id', created.company_id)
      .single();
    const { data: bank } = await supabase.client
      .from('accounts')
      .select('id')
      .eq('company_id', created.company_id)
      .eq('account_number', '1020')
      .single();
    expect(settings?.default_bank_account_id).toBe(bank?.id);

    const { count: accounts } = await supabase.client
      .from('accounts')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', created.company_id);
    const { count: template } = await supabase.client
      .from('coa_template')
      .select('account_number', { count: 'exact', head: true });
    expect(accounts).toBe(template);
    expect(accounts).toBe(186);

    const { count: periods } = await supabase.client
      .from('accounting_periods')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', created.company_id);
    expect(periods).toBe(4);

    const { data: member } = await supabase.client
      .from('company_members')
      .select('role')
      .eq('company_id', created.company_id)
      .eq('user_id', userId)
      .single();
    expect(member?.role).toBe('owner');

    const { data: customers } = await supabase.client
      .from('customers')
      .select('customer_name')
      .eq('company_id', created.company_id);
    expect(customers?.map((c) => c.customer_name)).toEqual(['Desert Mall']);
  });

  it('rolls back when a customer row fails after the company insert', async () => {
    const userId = await user('atomic');
    const legal = `Atomic ${userId}`;
    await expect(service.createWorkspace(userId, body(legal, [
      { customer_name: 'One', trn: '100000000000001' },
      { customer_name: 'Two', trn: '100000000000001' },
    ]))).rejects.toThrow('Could not create the workspace');

    const { count } = await supabase.client
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .eq('legal_name', legal);
    expect(count).toBe(0);
    const { count: members } = await supabase.client
      .from('company_members')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    expect(members).toBe(0);
  });

  it('does not let a second user read the first company', async () => {
    const userA = await user('owner');
    const userB = await user('other');
    const created = await service.createWorkspace(userA, body('Private Co'));
    createdCompanies.push(created.company_id);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
    const clientB = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: loginError } = await clientB.auth.signInWithPassword({
      email: `onboard-other-${userB}@infinity.local`,
      password: testUserPassword(),
    });
    if (loginError) throw loginError;

    const accounts = await clientB.from('accounts').select('id').eq('company_id', created.company_id);
    expect(accounts.data ?? []).toEqual([]);

    const companies = await clientB.from('companies').select('id').eq('id', created.company_id);
    expect(companies.data ?? []).toEqual([]);
  });
});
