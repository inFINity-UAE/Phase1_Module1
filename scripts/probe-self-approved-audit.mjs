/**
 * Probe #55: log_journal_entry_change self-approval notes on live Supabase.
 */
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
const owner = '00000000-0000-0000-0000-0000000000a2';
const other = '00000000-0000-0000-0000-0000000000b3';
const NOTE = 'Self-approved by Owner';

await client.from('companies').insert({
  id: companyId,
  legal_name: '#55 probe',
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
  .in('account_number', ['1010', '5100']);

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
const cash = accts.find((x) => x.account_number === '1010').id;
const expense = accts.find((x) => x.account_number === '5100').id;

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

async function insertDraft(createdBy) {
  const { data: entry } = await client
    .from('journal_entries')
    .insert({
      company_id: companyId,
      entry_number: Math.floor(Math.random() * 1e6),
      period_id: period.id,
      entry_date: '2026-01-10',
      entry_type: 'manual',
      status: 'draft',
      narration: '#55 probe',
      created_by: createdBy,
    })
    .select('id')
    .single();
  await client.from('journal_lines').insert([
    { journal_entry_id: entry.id, line_number: 1, account_id: expense, debit: 100, credit: 0 },
    { journal_entry_id: entry.id, line_number: 2, account_id: cash, debit: 0, credit: 100 },
  ]);
  return entry.id;
}

// Self-approval: approved_by = created_by on post
const selfId = await insertDraft(owner);
const now = new Date().toISOString();
await client
  .from('journal_entries')
  .update({
    status: 'posted',
    posted_at: now,
    approved_by: owner,
    approved_at: now,
  })
  .eq('id', selfId);

// Two-person: Owner approves other creator
const otherId = await insertDraft(other);
await client
  .from('journal_entries')
  .update({
    status: 'posted',
    posted_at: now,
    approved_by: owner,
    approved_at: now,
  })
  .eq('id', otherId);

const { data: selfAudit } = await client
  .from('audit_log')
  .select('action, notes, actor_id')
  .eq('record_id', selfId)
  .eq('table_name', 'journal_entries')
  .eq('action', 'status_change');

const { data: otherAudit } = await client
  .from('audit_log')
  .select('action, notes, actor_id')
  .eq('record_id', otherId)
  .eq('table_name', 'journal_entries')
  .eq('action', 'status_change');

const selfLabeled = (selfAudit ?? []).some((r) => r.notes === NOTE);
const otherUnlabeled = !(otherAudit ?? []).some((r) => r.notes === NOTE);

console.log(
  JSON.stringify(
    {
      self_approval_labeled: selfLabeled,
      two_person_unlabeled: otherUnlabeled,
      self_notes: selfAudit?.map((r) => r.notes),
      other_notes: otherAudit?.map((r) => r.notes),
    },
    null,
    2,
  ),
);

process.exit(selfLabeled && otherUnlabeled ? 0 : 2);
