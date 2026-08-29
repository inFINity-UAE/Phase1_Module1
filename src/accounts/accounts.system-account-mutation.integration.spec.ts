import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseModule } from '../database/database.module';
import { AccountsModule } from './accounts.module';
import { AccountsService } from './accounts.service';
import { SupabaseService } from '../database/supabase.service';
import { AccountCategory } from '../common/enums/account-category.enum';
import { mintFreshIntegrationCompany } from '../test/integration-company.setup';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

/**
 * [feature-spec.md decision #58 / §4.9]
 * trg_prevent_system_account_mutation blocks structural/identity UPDATEs on
 * is_system_account = true rows (service_role path). Metadata remains writable
 * at DB; Nest PATCH still rejects all system-account updates (#36).
 */
(hasSupabase ? describe : describe.skip)(
  'accounts system-account UPDATE guard (decision #58)',
  () => {
    jest.setTimeout(180_000);

    let service: AccountsService;
    let supabase: SupabaseService;
    let companyId = '';
    let systemAccountId = '';
    let regularAccountId = '';

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [DatabaseModule, AccountsModule],
      }).compile();

      service = module.get(AccountsService);
      supabase = module.get(SupabaseService);

      companyId = await mintFreshIntegrationCompany(
        supabase,
        'System Account Mutation Integration',
      );

      const { data: retained, error: retainedError } = await supabase.client
        .from('accounts')
        .select('id, account_number, is_system_account, description')
        .eq('company_id', companyId)
        .eq('account_number', '3100')
        .single();

      if (retainedError || !retained) {
        throw retainedError ?? new Error('3100 Retained Earnings not found');
      }
      expect(retained.is_system_account).toBe(true);
      systemAccountId = retained.id as string;

      const { data: regular, error: regularError } = await supabase.client
        .from('accounts')
        .select('id, is_system_account')
        .eq('company_id', companyId)
        .eq('account_number', '1010')
        .single();

      if (regularError || !regular) {
        throw regularError ?? new Error('1010 Cash not found');
      }
      expect(regular.is_system_account).toBe(false);
      regularAccountId = regular.id as string;
    }, 120_000);

    it('rejects structural UPDATE on system account 3100 via direct SQL (#58)', async () => {
      const { error: numberError } = await supabase.client
        .from('accounts')
        .update({ account_number: '3199' })
        .eq('id', systemAccountId);

      expect(numberError).not.toBeNull();
      expect(numberError!.code).toBe('P0001');
      expect(numberError!.message).toMatch(/System accounts cannot change structural/i);

      const { error: flagError } = await supabase.client
        .from('accounts')
        .update({ is_system_account: false })
        .eq('id', systemAccountId);

      expect(flagError).not.toBeNull();
      expect(flagError!.code).toBe('P0001');

      const { error: activeError } = await supabase.client
        .from('accounts')
        .update({ is_active: false })
        .eq('id', systemAccountId);

      expect(activeError).not.toBeNull();
      expect(activeError!.code).toBe('P0001');

      const { data: still } = await supabase.client
        .from('accounts')
        .select('account_number, is_system_account, is_active')
        .eq('id', systemAccountId)
        .single();

      expect(still!.account_number).toBe('3100');
      expect(still!.is_system_account).toBe(true);
      expect(still!.is_active).toBe(true);
    });

    it('allows metadata-only UPDATE (description) on system account 3100 via direct SQL (#58)', async () => {
      const marker = `system-meta-${Date.now()}`;
      const { data, error } = await supabase.client
        .from('accounts')
        .update({ description: marker })
        .eq('id', systemAccountId)
        .select('id, description, account_number, is_system_account')
        .single();

      expect(error).toBeNull();
      expect(data!.description).toBe(marker);
      expect(data!.account_number).toBe('3100');
      expect(data!.is_system_account).toBe(true);
    });

    it('does not affect regular (non-system) accounts (#58)', async () => {
      const { data: renamed, error: renameError } = await supabase.client
        .from('accounts')
        .update({ account_name: 'Cash (renamed for #58 probe)' })
        .eq('id', regularAccountId)
        .select('account_name, is_system_account')
        .single();

      expect(renameError).toBeNull();
      expect(renamed!.is_system_account).toBe(false);
      expect(renamed!.account_name).toContain('#58');

      const { error: deactivateError } = await supabase.client
        .from('accounts')
        .update({ is_active: false })
        .eq('id', regularAccountId);

      expect(deactivateError).toBeNull();

      const { error: reactivateError } = await supabase.client
        .from('accounts')
        .update({ is_active: true })
        .eq('id', regularAccountId);

      expect(reactivateError).toBeNull();
    });

    it('Nest PATCH still blocks all system-account updates; DB backstops structural (#58)', async () => {
      await expect(
        service.update(systemAccountId, { description: 'nest should reject' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.update(systemAccountId, { description: 'nest should reject' }),
      ).rejects.toThrow(/is a system account and cannot be updated/i);

      await expect(service.deactivate(systemAccountId)).rejects.toThrow(
        /is a system account and cannot be deactivated/i,
      );

      // Direct service_role structural change still rejected by trigger.
      const { error } = await supabase.client
        .from('accounts')
        .update({ category: AccountCategory.Liability })
        .eq('id', systemAccountId);

      expect(error).not.toBeNull();
      expect(error!.code).toBe('P0001');

      // Regular Nest metadata PATCH still works.
      const updated = await service.update(regularAccountId, {
        account_name: 'Cash on Hand (#58)',
      });
      expect(updated.account_name).toBe('Cash on Hand (#58)');
      expect(updated.is_system_account).toBe(false);
    });
  },
);
