import { SupabaseAccountsRepository } from './accounts.repository.supabase';
import { AccountCategory } from '../common/enums/account-category.enum';
import { NormalBalance } from '../common/enums/normal-balance.enum';
import { CreateAccountDto } from './dto/create-account.dto';

/**
 * [feature-spec.md §7.16 finding #2 / decision #42] Insert always uses
 * service-controlled defaults for system/lock columns.
 */
describe('SupabaseAccountsRepository.insert system defaults', () => {
  it('writes is_system_account=false and locked_*=null regardless of DTO shape', async () => {
    const insertPayloads: Record<string, unknown>[] = [];
    const supabase = {
      client: {
        from: () => ({
          insert: (row: Record<string, unknown>) => {
            insertPayloads.push(row);
            return {
              select: () => ({
                single: async () => ({
                  data: { id: '11111111-1111-1111-1111-111111111111', ...row },
                  error: null,
                }),
              }),
            };
          },
        }),
      },
    };

    const repo = new SupabaseAccountsRepository(supabase as never);
    const dto: CreateAccountDto = {
      company_id: '00000000-0000-0000-0000-000000000002',
      account_number: '1998',
      account_name: 'Custom',
      category: AccountCategory.Asset,
      normal_balance: NormalBalance.Debit,
    };

    await repo.insert(dto);

    expect(insertPayloads).toHaveLength(1);
    expect(insertPayloads[0]).toMatchObject({
      is_system_account: false,
      locked_at: null,
      locked_reason: null,
    });
    expect(insertPayloads[0]).not.toHaveProperty('is_system_account', true);
  });
});
