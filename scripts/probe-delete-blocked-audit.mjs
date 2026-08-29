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
const actor = '00000000-0000-0000-0000-0000000000a2';

await client.from('companies').insert({
  id: companyId,
  legal_name: '#56 probe',
  base_currency: 'AED',
  is_free_zone_entity: false,
  fiscal_year_start_month: 1,
});

const { data: seed } = await client
  .from('accounts')
  .select(
    'account_number, account_name, category, sub_category, normal_balance, is_system_account, is_active, description',
  )
  .eq('company_id', DEMO)
  .in('account_number', ['1020', '1010']);

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
const a = accts.find((x) => x.account_number === '1010').id;
const b = accts.find((x) => x.account_number === '1020').id;

const { data: period } = await client
  .from('accounting_periods')
  .insert({
    company_id: companyId,
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    fiscal_year: 2026,
    status: 'open',
  })
  .select('id')
  .single();

const { data: entry } = await client
  .from('journal_entries')
  .insert({
    company_id: companyId,
    entry_number: 1,
    period_id: period.id,
    entry_date: '2026-01-10',
    entry_type: 'manual',
    status: 'draft',
    narration: '#56 probe',
    created_by: actor,
  })
  .select('id')
  .single();

await client.from('journal_lines').insert([
  { journal_entry_id: entry.id, line_number: 1, account_id: a, debit: 10, credit: 0 },
  { journal_entry_id: entry.id, line_number: 2, account_id: b, debit: 0, credit: 10 },
]);

await client
  .from('journal_entries')
  .update({ status: 'posted', posted_at: new Date().toISOString() })
  .eq('id', entry.id);

const { error: delErr } = await client.from('journal_entries').delete().eq('id', entry.id);
const { data: line } = await client
  .from('journal_lines')
  .select('id')
  .eq('journal_entry_id', entry.id)
  .limit(1)
  .single();
const { error: lineErr } = await client.from('journal_lines').delete().eq('id', line.id);

const { error: enumErr } = await client.from('audit_log').insert({
  company_id: companyId,
  table_name: 'journal_entries',
  record_id: entry.id,
  action: 'delete_blocked',
  actor_id: actor,
  old_data: { probe: true },
  notes: 'probe',
});

console.log(
  JSON.stringify(
    {
      entry_delete_message: delErr?.message ?? null,
      entry_token_ok: (delErr?.message ?? '').includes('POSTED_ENTRY_DELETE_BLOCKED'),
      line_delete_message: lineErr?.message ?? null,
      line_token_ok: (lineErr?.message ?? '').includes('POSTED_LINE_DELETE_BLOCKED'),
      delete_blocked_enum_ok: !enumErr,
      enum_error: enumErr?.message ?? null,
    },
    null,
    2,
  ),
);

const ok =
  (delErr?.message ?? '').includes('POSTED_ENTRY_DELETE_BLOCKED') &&
  (lineErr?.message ?? '').includes('POSTED_LINE_DELETE_BLOCKED') &&
  !enumErr;
process.exit(ok ? 0 : 2);
