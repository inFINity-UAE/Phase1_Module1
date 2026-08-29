import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env.local') });

const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
);

const companyId = randomUUID();
const DEMO = '00000000-0000-0000-0000-000000000002';

await client.from('companies').insert({
  id: companyId,
  legal_name: 'RPC category probe',
  base_currency: 'AED',
  is_free_zone_entity: false,
  fiscal_year_start_month: 1,
});
await client.from('company_settings').upsert({
  company_id: companyId,
  journal_approval_threshold: 5000,
  approval_threshold_currency: 'AED',
  default_period_length: 'monthly',
  allow_period_reopen: true,
});

const { data: seed } = await client
  .from('accounts')
  .select(
    'account_number, account_name, category, sub_category, normal_balance, parent_account_id, depth, is_system_account, is_active, description',
  )
  .eq('company_id', DEMO)
  .in('account_number', ['1020', '4000']);

for (const a of seed ?? []) {
  await client.from('accounts').insert({
    ...a,
    company_id: companyId,
    parent_account_id: null,
    depth: 1,
  });
}

const { data: accts } = await client
  .from('accounts')
  .select('id, account_number')
  .eq('company_id', companyId);
const bank = accts.find((a) => a.account_number === '1020').id;
const income = accts.find((a) => a.account_number === '4000').id;

await client.from('accounting_periods').insert({
  company_id: companyId,
  period_start: '2026-01-01',
  period_end: '2026-01-31',
  fiscal_year: 2026,
  status: 'open',
});

const { error } = await client.rpc('create_opening_balance_entry', {
  p_company_id: companyId,
  p_fiscal_year: 2026,
  p_entry_date: '2026-01-01',
  p_narration: 'RPC category probe',
  p_created_by: '00000000-0000-0000-0000-0000000000a2',
  p_lines: [
    { line_number: 1, account_id: bank, debit: 100, credit: 0 },
    { line_number: 2, account_id: income, debit: 0, credit: 100 },
  ],
  p_reference_number: null,
});

const { count } = await client
  .from('journal_entries')
  .select('id', { count: 'exact', head: true })
  .eq('company_id', companyId);

const msg = error?.message ?? '';
const pass = msg.includes('OPENING_BALANCE_INVALID_ACCOUNT_CATEGORY') && (count ?? 0) === 0;

console.log(
  JSON.stringify(
    {
      live_rpc_backstop: pass ? 'OK' : 'FAIL',
      error_message: msg || null,
      journal_entries_created: count ?? 0,
    },
    null,
    2,
  ),
);

process.exit(pass ? 0 : 1);
