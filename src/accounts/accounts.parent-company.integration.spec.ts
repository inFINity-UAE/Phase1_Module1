import { config } from 'dotenv';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

config({ path: resolve(__dirname, '../../.env.local') });

import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseModule } from '../database/database.module';
import { AccountsModule } from './accounts.module';
import { AccountsService } from './accounts.service';
import { SupabaseService } from '../database/supabase.service';
import { AccountCategory } from '../common/enums/account-category.enum';
import { NormalBalance } from '../common/enums/normal-balance.enum';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

/**
 * [feature-spec.md decision #45 / §7.16 finding #5]
 * enforce_account_hierarchy_depth rejects cross-company parent_account_id
 * on INSERT and UPDATE; same-company parents still compute depth correctly.
 */
(hasSupabase ? describe : describe.skip)(
  'accounts parent_account_id same-company (decision #45)',
  () => {
    jest.setTimeout(120_000);

    let service: AccountsService;
    let supabase: SupabaseService;
    let companyA = '';
    let companyB = '';

    async function insertCompany(legalName: string): Promise<string> {
      const id = randomUUID();
      const { error } = await supabase.client.from('companies').insert({
        id,
        legal_name: legalName,
        base_currency: 'AED',
        is_free_zone_entity: false,
        fiscal_year_start_month: 1,
      });
      if (error) {
        throw error;
      }
      return id;
    }

    async function insertAccount(params: {
      company_id: string;
      account_number: string;
      account_name: string;
      parent_account_id?: string | null;
    }) {
      const { data, error } = await supabase.client
        .from('accounts')
        .insert({
          company_id: params.company_id,
          account_number: params.account_number,
          account_name: params.account_name,
          category: AccountCategory.Asset,
          normal_balance: NormalBalance.Debit,
          parent_account_id: params.parent_account_id ?? null,
          is_system_account: false,
          is_active: true,
        })
        .select('id, company_id, parent_account_id, depth')
        .single();
      return { data, error };
    }

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, AccountsModule],
      }).compile();

      service = module.get(AccountsService);
      supabase = module.get(SupabaseService);

      companyA = await insertCompany(`Parent-co A ${randomUUID()}`);
      companyB = await insertCompany(`Parent-co B ${randomUUID()}`);
    }, 120000);

    it('rejects create with parent_account_id from a different company', async () => {
      const parentB = await insertAccount({
        company_id: companyB,
        account_number: '1100',
        account_name: 'B root',
      });
      expect(parentB.error).toBeNull();

      await expect(
        service.create({
          company_id: companyA,
          account_number: '1101',
          account_name: 'A child of B parent',
          category: AccountCategory.Asset,
          normal_balance: NormalBalance.Debit,
          parent_account_id: parentB.data!.id,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.create({
          company_id: companyA,
          account_number: '1101',
          account_name: 'A child of B parent',
          category: AccountCategory.Asset,
          normal_balance: NormalBalance.Debit,
          parent_account_id: parentB.data!.id,
        }),
      ).rejects.toThrow(/belongs to a different company/i);
    });

    it('rejects raw UPDATE that reparents to a different company', async () => {
      const parentA = await insertAccount({
        company_id: companyA,
        account_number: '1200',
        account_name: 'A root for update',
      });
      const childA = await insertAccount({
        company_id: companyA,
        account_number: '1201',
        account_name: 'A child',
        parent_account_id: parentA.data!.id,
      });
      expect(childA.error).toBeNull();
      expect(childA.data!.depth).toBe(2);

      const parentB = await insertAccount({
        company_id: companyB,
        account_number: '1200',
        account_name: 'B root for update',
      });
      expect(parentB.error).toBeNull();

      const { error } = await supabase.client
        .from('accounts')
        .update({ parent_account_id: parentB.data!.id })
        .eq('id', childA.data!.id)
        .select()
        .single();

      expect(error).not.toBeNull();
      expect(error!.code).toBe('P0001');
      expect(error!.message).toMatch(/belongs to a different company/i);
    });

    it('accepts same-company parent and computes depth correctly', async () => {
      const root = await insertAccount({
        company_id: companyA,
        account_number: '1300',
        account_name: 'A depth root',
      });
      expect(root.error).toBeNull();
      expect(root.data!.depth).toBe(1);

      const child = await service.create({
        company_id: companyA,
        account_number: '1301',
        account_name: 'A depth child',
        category: AccountCategory.Asset,
        normal_balance: NormalBalance.Debit,
        parent_account_id: root.data!.id,
      });

      expect(child.parent_account_id).toBe(root.data!.id);
      expect(child.depth).toBe(2);
    });

    it('cross-company parent at depth 4 rejects as different-company (not depth)', async () => {
      // Build a 4-level chain in company B.
      const b1 = await insertAccount({
        company_id: companyB,
        account_number: '1400',
        account_name: 'B L1',
      });
      const b2 = await insertAccount({
        company_id: companyB,
        account_number: '1401',
        account_name: 'B L2',
        parent_account_id: b1.data!.id,
      });
      const b3 = await insertAccount({
        company_id: companyB,
        account_number: '1402',
        account_name: 'B L3',
        parent_account_id: b2.data!.id,
      });
      const b4 = await insertAccount({
        company_id: companyB,
        account_number: '1403',
        account_name: 'B L4',
        parent_account_id: b3.data!.id,
      });
      expect(b4.error).toBeNull();
      expect(b4.data!.depth).toBe(4);

      const { error: crossError } = await insertAccount({
        company_id: companyA,
        account_number: '1404',
        account_name: 'A under B L4',
        parent_account_id: b4.data!.id,
      });
      expect(crossError).not.toBeNull();
      expect(crossError!.code).toBe('P0001');
      expect(crossError!.message).toMatch(/belongs to a different company/i);
      expect(crossError!.message).not.toMatch(/4 levels/i);

      // Same-company 5th level still hits the existing depth rule.
      const { error: depthError } = await insertAccount({
        company_id: companyB,
        account_number: '1404',
        account_name: 'B L5 illegal',
        parent_account_id: b4.data!.id,
      });
      expect(depthError).not.toBeNull();
      expect(depthError!.code).toBe('P0001');
      expect(depthError!.message).toMatch(/4 levels deep/i);
    });
  },
);
