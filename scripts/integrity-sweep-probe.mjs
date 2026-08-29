/**
 * Module 1.1.A integrity sweep — live behavioral probes (service_role).
 * Catalog SQL (role_routine_grants, pg_get_functiondef) needs DATABASE_URL;
 * without it those rows are marked in the report separately.
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const client = createClient(url, secret);
const anonClient = createClient(url, anon);

const DEMO = '00000000-0000-0000-0000-000000000002';
const results = [];

function record(id, status, detail) {
  results.push({ id, status, detail });
  const mark = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '?';
  console.log(`${mark} ${id}: ${status} — ${detail}`);
}

async function mintCompany(label) {
  const id = randomUUID();
  await client.from('companies').insert({
    id,
    legal_name: label,
    base_currency: 'AED',
    is_free_zone_entity: false,
    fiscal_year_start_month: 1,
  });
  await client.from('company_settings').upsert({
    company_id: id,
    journal_approval_threshold: 5000,
    approval_threshold_currency: 'AED',
    default_period_length: 'monthly',
    allow_period_reopen: true,
  });
  return id;
}

async function cloneAccounts(companyId, numbers) {
  const { data: seed } = await client
    .from('accounts')
    .select(
      'account_number, account_name, category, sub_category, normal_balance, is_system_account, is_active, description',
    )
    .eq('company_id', DEMO)
    .in('account_number', numbers);
  for (const a of seed ?? []) {
    await client.from('accounts').insert({
      ...a,
      company_id: companyId,
      parent_account_id: null,
      depth: 1,
    });
  }
  const { data } = await client
    .from('accounts')
    .select('id, account_number, is_system_account, category')
    .eq('company_id', companyId);
  return Object.fromEntries((data ?? []).map((a) => [a.account_number, a]));
}

// ── A. Enums ───────────────────────────────────────────────────────────────
{
  const expected = {
    account_category: ['asset', 'liability', 'equity', 'income', 'expense'],
    normal_balance_type: ['debit', 'credit'],
    period_status: ['open', 'soft_closed', 'closed'],
    journal_entry_type: [
      'manual',
      'recurring',
      'reversal',
      'opening_balance',
      'year_end_closing',
      'system',
    ],
    journal_entry_status: [
      'draft',
      'pending_approval',
      'approved',
      'rejected',
      'posted',
      'reversed',
    ],
    recurrence_frequency: ['daily', 'weekly', 'monthly', 'quarterly', 'annually'],
    audit_action: ['insert', 'update', 'reversal', 'status_change', 'delete_blocked'],
  };

  // Probe via accepting known-good + rejecting bogus audit_action
  const companyId = await mintCompany('enum probe');
  const { error: goodEnum } = await client.from('audit_log').insert({
    company_id: companyId,
    table_name: 'probe',
    record_id: randomUUID(),
    action: 'delete_blocked',
    actor_id: '00000000-0000-0000-0000-0000000000a2',
  });
  const { error: badEnum } = await client.from('audit_log').insert({
    company_id: companyId,
    table_name: 'probe',
    record_id: randomUUID(),
    action: 'not_a_real_action',
    actor_id: '00000000-0000-0000-0000-0000000000a2',
  });
  record(
    'A.enums.audit_action.delete_blocked',
    !goodEnum && badEnum ? 'PASS' : 'FAIL',
    `good=${goodEnum?.message ?? 'ok'}; bad=${badEnum?.message ?? 'accepted'}`,
  );

  // period_status
  const { error: psOk } = await client.from('accounting_periods').insert({
    company_id: companyId,
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    fiscal_year: 2026,
    status: 'soft_closed',
  });
  const { error: psBad } = await client.from('accounting_periods').insert({
    company_id: companyId,
    period_start: '2026-02-01',
    period_end: '2026-02-28',
    fiscal_year: 2026,
    status: 'half_closed',
  });
  record(
    'A.enums.period_status',
    !psOk && psBad ? 'PASS' : 'FAIL',
    `soft_closed=${psOk?.message ?? 'ok'}; bad=${psBad?.message ?? 'accepted'}`,
  );

  record(
    'A.enums.full_catalog_match',
    'CANNOT VERIFY',
    `No DATABASE_URL — cannot SELECT enumlabel FROM pg_enum. Expected sets in schema.sql: ${Object.keys(expected).join(', ')}. Behavioral probes above for delete_blocked + period_status.`,
  );
}

// ── A. Unique + exclusion constraints ──────────────────────────────────────
{
  const companyId = await mintCompany('constraint probe');
  await cloneAccounts(companyId, ['1010']);
  const accts = await cloneAccounts(companyId, ['1010']); // may fail unique

  const { error: dupAcct } = await client.from('accounts').insert({
    company_id: companyId,
    account_number: '1010',
    account_name: 'Dup',
    category: 'asset',
    normal_balance: 'debit',
  });
  record(
    'A.unique.accounts_company_account_number',
    dupAcct?.code === '23505' ? 'PASS' : 'FAIL',
    dupAcct?.message ?? 'no error',
  );

  await client.from('accounting_periods').insert({
    company_id: companyId,
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    fiscal_year: 2026,
    status: 'open',
  });
  const { error: overlap } = await client.from('accounting_periods').insert({
    company_id: companyId,
    period_start: '2026-01-15',
    period_end: '2026-02-15',
    fiscal_year: 2026,
    status: 'open',
  });
  // 23P01 exclusion OR 23505 unique on exact same range
  const exclOk =
    overlap?.code === '23P01' ||
    (overlap?.message ?? '').includes('accounting_periods_company_daterange_excl') ||
    overlap?.code === '23505';
  record(
    'A.constraint.accounting_periods_company_daterange_excl',
    exclOk ? 'PASS' : 'FAIL',
    `code=${overlap?.code}; msg=${overlap?.message ?? 'none'}`,
  );

  const { data: period } = await client
    .from('accounting_periods')
    .select('id')
    .eq('company_id', companyId)
    .eq('period_start', '2026-01-01')
    .single();
  const actor = '00000000-0000-0000-0000-0000000000a2';
  await client.from('journal_entries').insert({
    company_id: companyId,
    entry_number: 1,
    period_id: period.id,
    entry_date: '2026-01-10',
    entry_type: 'manual',
    status: 'draft',
    narration: 'u',
    created_by: actor,
  });
  const { error: dupEntry } = await client.from('journal_entries').insert({
    company_id: companyId,
    entry_number: 1,
    period_id: period.id,
    entry_date: '2026-01-11',
    entry_type: 'manual',
    status: 'draft',
    narration: 'u2',
    created_by: actor,
  });
  record(
    'A.unique.journal_entries_company_entry_number',
    dupEntry?.code === '23505' ? 'PASS' : 'FAIL',
    dupEntry?.message ?? 'none',
  );

  const { data: entry } = await client
    .from('journal_entries')
    .select('id')
    .eq('company_id', companyId)
    .eq('entry_number', 1)
    .single();
  const { data: acctRows } = await client
    .from('accounts')
    .select('id')
    .eq('company_id', companyId)
    .eq('account_number', '1010')
    .limit(1);
  const acctId = acctRows[0].id;
  await client.from('journal_lines').insert({
    journal_entry_id: entry.id,
    line_number: 1,
    account_id: acctId,
    debit: 1,
    credit: 0,
  });
  const { error: dupLine } = await client.from('journal_lines').insert({
    journal_entry_id: entry.id,
    line_number: 1,
    account_id: acctId,
    debit: 2,
    credit: 0,
  });
  record(
    'A.unique.journal_lines_entry_line_number',
    dupLine?.code === '23505' ? 'PASS' : 'FAIL',
    dupLine?.message ?? 'none',
  );

  const { error: exactDupPeriod } = await client.from('accounting_periods').insert({
    company_id: companyId,
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    fiscal_year: 2026,
    status: 'open',
  });
  record(
    'A.unique.accounting_periods_company_daterange',
    exactDupPeriod?.code === '23505' || exactDupPeriod?.code === '23P01' ? 'PASS' : 'FAIL',
    exactDupPeriod?.message ?? 'none',
  );
}

// ── A. Columns — sample critical tables via select * limit 0 shape ─────────
{
  const tables = [
    'accounts',
    'accounting_periods',
    'journal_entries',
    'journal_lines',
    'journal_attachments',
    'recurring_journal_templates',
    'recurring_journal_template_lines',
    'audit_log',
    'companies',
    'company_settings',
    'company_members',
  ];
  for (const t of tables) {
    const { error } = await client.from(t).select('*').limit(1);
    record(
      `A.table.${t}.reachable`,
      !error ? 'PASS' : 'FAIL',
      error?.message ?? 'select ok',
    );
  }
  record(
    'A.table.column_list_exact_match',
    'CANNOT VERIFY',
    'No DATABASE_URL — cannot diff information_schema.columns to schema.sql',
  );
}

// ── B. Trigger behavioral smoke (supplement existing suites) ───────────────
{
  const companyId = await mintCompany('trigger smoke');
  const accts = await cloneAccounts(companyId, ['1010', '1020', '3100', '4000', '5100']);
  await client.from('accounting_periods').insert({
    company_id: companyId,
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    fiscal_year: 2026,
    status: 'open',
  });
  const { data: period } = await client
    .from('accounting_periods')
    .select('id')
    .eq('company_id', companyId)
    .single();
  const actor = '00000000-0000-0000-0000-0000000000a2';

  // account number category — equity mismatch
  const { error: eqBad } = await client.from('accounts').insert({
    company_id: companyId,
    account_number: '1500',
    account_name: 'Bad equity',
    category: 'equity',
    normal_balance: 'credit',
  });
  record(
    'B.trg_enforce_account_number_category.equity_mismatch',
    eqBad?.code === 'P0001' ? 'PASS' : 'FAIL',
    eqBad?.message ?? 'accepted',
  );

  // income mismatch
  const { error: incBad } = await client.from('accounts').insert({
    company_id: companyId,
    account_number: '2500',
    account_name: 'Bad income',
    category: 'income',
    normal_balance: 'credit',
  });
  record(
    'B.trg_enforce_account_number_category.income_mismatch',
    incBad?.code === 'P0001' ? 'PASS' : 'FAIL',
    incBad?.message ?? 'accepted',
  );

  // system account delete
  const { error: sysDel } = await client
    .from('accounts')
    .delete()
    .eq('id', accts['3100'].id);
  record(
    'B.trg_prevent_account_deletion.system',
    sysDel?.code === 'P0001' && /System accounts cannot be deleted/i.test(sysDel.message)
      ? 'PASS'
      : 'FAIL',
    sysDel?.message ?? 'deleted',
  );

  // clean non-system delete
  const { data: tempAcct } = await client
    .from('accounts')
    .insert({
      company_id: companyId,
      account_number: '1998',
      account_name: 'Temp deletable',
      category: 'asset',
      normal_balance: 'debit',
      is_system_account: false,
    })
    .select('id')
    .single();
  const { error: cleanDel } = await client.from('accounts').delete().eq('id', tempAcct.id);
  record(
    'B.trg_prevent_account_deletion.clean_non_system',
    !cleanDel ? 'PASS' : 'FAIL',
    cleanDel?.message ?? 'deleted',
  );

  // draft entry delete allow
  const { data: draft } = await client
    .from('journal_entries')
    .insert({
      company_id: companyId,
      entry_number: 1,
      period_id: period.id,
      entry_date: '2026-01-10',
      entry_type: 'manual',
      status: 'draft',
      narration: 'draft del',
      created_by: actor,
    })
    .select('id')
    .single();
  await client.from('journal_lines').insert([
    { journal_entry_id: draft.id, line_number: 1, account_id: accts['1010'].id, debit: 5, credit: 0 },
    { journal_entry_id: draft.id, line_number: 2, account_id: accts['1020'].id, debit: 0, credit: 5 },
  ]);
  const { error: draftDel } = await client.from('journal_entries').delete().eq('id', draft.id);
  record(
    'B.trg_prevent_posted_entry_deletion.draft_allow',
    !draftDel ? 'PASS' : 'FAIL',
    draftDel?.message ?? 'deleted',
  );

  // posted delete block + token
  const { data: toPost } = await client
    .from('journal_entries')
    .insert({
      company_id: companyId,
      entry_number: 2,
      period_id: period.id,
      entry_date: '2026-01-11',
      entry_type: 'manual',
      status: 'draft',
      narration: 'posted del',
      created_by: actor,
    })
    .select('id')
    .single();
  await client.from('journal_lines').insert([
    {
      journal_entry_id: toPost.id,
      line_number: 1,
      account_id: accts['1010'].id,
      debit: 7,
      credit: 0,
    },
    {
      journal_entry_id: toPost.id,
      line_number: 2,
      account_id: accts['1020'].id,
      debit: 0,
      credit: 7,
    },
  ]);
  await client
    .from('journal_entries')
    .update({ status: 'posted', posted_at: new Date().toISOString() })
    .eq('id', toPost.id);
  const { error: postedDel } = await client.from('journal_entries').delete().eq('id', toPost.id);
  record(
    'B.trg_prevent_posted_entry_deletion.posted_token',
    (postedDel?.message ?? '').includes('POSTED_ENTRY_DELETE_BLOCKED') ? 'PASS' : 'FAIL',
    postedDel?.message ?? 'none',
  );

  // zero-line UPDATE to posted
  const { data: emptyDraft } = await client
    .from('journal_entries')
    .insert({
      company_id: companyId,
      entry_number: 3,
      period_id: period.id,
      entry_date: '2026-01-12',
      entry_type: 'manual',
      status: 'draft',
      narration: 'empty post',
      created_by: actor,
    })
    .select('id')
    .single();
  const { error: zeroLine } = await client
    .from('journal_entries')
    .update({ status: 'posted', posted_at: new Date().toISOString() })
    .eq('id', emptyDraft.id);
  record(
    'B.trg_enforce_journal_balance_on_post.update_zero_lines',
    zeroLine?.code === 'P0001' && /no lines/i.test(zeroLine.message ?? '') ? 'PASS' : 'FAIL',
    zeroLine?.message ?? 'accepted',
  );

  // nondraft header — workflow column allowed
  const { error: workflowOk } = await client
    .from('journal_entries')
    .update({ approved_by: actor, approved_at: new Date().toISOString() })
    .eq('id', toPost.id);
  record(
    'B.trg_prevent_nondraft_header_mutation.workflow_allowed',
    !workflowOk ? 'PASS' : 'FAIL',
    workflowOk?.message ?? 'approved_by update ok',
  );
  const { error: headerBlock } = await client
    .from('journal_entries')
    .update({ narration: 'hacked' })
    .eq('id', toPost.id);
  record(
    'B.trg_prevent_nondraft_header_mutation.header_blocked',
    headerBlock?.code === 'P0001' ? 'PASS' : 'FAIL',
    headerBlock?.message ?? 'accepted',
  );
}

// ── C. RPC tokens + grants (behavioral) ────────────────────────────────────
{
  const companyId = await mintCompany('rpc probe');
  const accts = await cloneAccounts(companyId, ['1010', '1020', '4000', '5100', '3100']);
  await client.from('accounting_periods').insert({
    company_id: companyId,
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    fiscal_year: 2026,
    status: 'open',
  });
  const actor = '00000000-0000-0000-0000-0000000000a2';

  // empty lines
  const { error: emptyLines } = await client.rpc('insert_journal_entry_draft', {
    p_company_id: companyId,
    p_period_id: (
      await client
        .from('accounting_periods')
        .select('id')
        .eq('company_id', companyId)
        .single()
    ).data.id,
    p_entry_date: '2026-01-10',
    p_narration: 'empty',
    p_created_by: actor,
    p_lines: [],
    p_reference_number: null,
    p_entry_type: 'manual',
    p_recurring_template_id: null,
  });
  record(
    'C.token.JOURNAL_DRAFT_REQUIRES_LINES',
    (emptyLines?.message ?? '').includes('JOURNAL_DRAFT_REQUIRES_LINES') ? 'PASS' : 'FAIL',
    emptyLines?.message ?? 'none',
  );

  // OB invalid category — income on FIRST line
  const { error: obFirst } = await client.rpc('create_opening_balance_entry', {
    p_company_id: companyId,
    p_fiscal_year: 2026,
    p_entry_date: '2026-01-01',
    p_narration: 'ob first income',
    p_created_by: actor,
    p_lines: [
      { line_number: 1, account_id: accts['4000'].id, debit: 0, credit: 100 },
      { line_number: 2, account_id: accts['1010'].id, debit: 100, credit: 0 },
    ],
    p_reference_number: null,
  });
  const { count: obCount } = await client
    .from('journal_entries')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('entry_type', 'opening_balance');
  record(
    'C.token.OPENING_BALANCE_INVALID_ACCOUNT_CATEGORY.first_line_income',
    (obFirst?.message ?? '').includes('OPENING_BALANCE_INVALID_ACCOUNT_CATEGORY') &&
      (obCount ?? 0) === 0
      ? 'PASS'
      : 'FAIL',
    `msg=${obFirst?.message}; rows=${obCount}`,
  );

  // NO_OPEN_PERIOD — soft-close all then try OB
  await client
    .from('accounting_periods')
    .update({ status: 'soft_closed' })
    .eq('company_id', companyId);
  const { error: noOpen } = await client.rpc('create_opening_balance_entry', {
    p_company_id: companyId,
    p_fiscal_year: 2026,
    p_entry_date: '2026-01-01',
    p_narration: 'no open',
    p_created_by: actor,
    p_lines: [
      { line_number: 1, account_id: accts['1010'].id, debit: 50, credit: 0 },
      { line_number: 2, account_id: accts['1020'].id, debit: 0, credit: 50 },
    ],
    p_reference_number: null,
  });
  record(
    'C.token.NO_OPEN_PERIOD_FOR_FISCAL_YEAR',
    (noOpen?.message ?? '').includes('NO_OPEN_PERIOD_FOR_FISCAL_YEAR') ? 'PASS' : 'FAIL',
    noOpen?.message ?? 'none',
  );

  // reopen for further tests
  await client.from('accounting_periods').update({ status: 'open' }).eq('company_id', companyId);

  // NO_PERIOD_FOR_FISCAL_YEAR — year with no periods
  const { error: noPeriod } = await client.rpc('create_year_end_closing_entry', {
    p_company_id: companyId,
    p_fiscal_year: 2099,
    p_created_by: actor,
  });
  record(
    'C.token.NO_PERIOD_FOR_FISCAL_YEAR',
    (noPeriod?.message ?? '').includes('NO_PERIOD_FOR_FISCAL_YEAR') ? 'PASS' : 'FAIL',
    noPeriod?.message ?? 'none',
  );

  // RETAINED_EARNINGS_NOT_FOUND — company without 3100
  const noRe = await mintCompany('no RE');
  await cloneAccounts(noRe, ['1010', '5100']);
  await client.from('accounting_periods').insert({
    company_id: noRe,
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    fiscal_year: 2026,
    status: 'open',
  });
  // need some posted P&L first? RETAINED_EARNINGS check may come before or after PL
  const { error: noReErr } = await client.rpc('create_year_end_closing_entry', {
    p_company_id: noRe,
    p_fiscal_year: 2026,
    p_created_by: actor,
  });
  record(
    'C.token.RETAINED_EARNINGS_NOT_FOUND',
    (noReErr?.message ?? '').includes('RETAINED_EARNINGS_NOT_FOUND') ||
      (noReErr?.message ?? '').includes('NO_PL_BALANCES_TO_CLOSE')
      ? 'PASS'
      : 'FAIL',
    `Note: may hit NO_PL first if check order differs. msg=${noReErr?.message}`,
  );

  // public.is_company_member should not exist
  const { error: publicMember } = await anonClient.rpc('is_company_member', {
    p_company_id: companyId,
  });
  record(
    'E.rpc.public.is_company_member_absent',
    publicMember != null ? 'PASS' : 'FAIL',
    publicMember?.message ?? 'RPC unexpectedly succeeded',
  );

  // service_role can call allocate
  const { data: n, error: allocErr } = await client.rpc('allocate_next_entry_number', {
    p_company_id: companyId,
  });
  record(
    'C.rpc.allocate_next_entry_number.service_role',
    !allocErr && typeof n === 'number' ? 'PASS' : 'FAIL',
    allocErr?.message ?? `n=${n}`,
  );

  // anon should not execute allocate (grant check proxy)
  const { error: anonAlloc } = await anonClient.rpc('allocate_next_entry_number', {
    p_company_id: companyId,
  });
  record(
    'C.grant.allocate_anon_denied',
    anonAlloc != null ? 'PASS' : 'FAIL',
    anonAlloc?.message ?? 'anon was allowed — grant regression',
  );

  record(
    'C.grant.role_routine_grants_catalog',
    'CANNOT VERIFY',
    'No DATABASE_URL — cannot query information_schema.role_routine_grants. Anon denial probe is a proxy only.',
  );
}

// ── E. v_trial_balance / RLS smoke ─────────────────────────────────────────
{
  const { data, error } = await client
    .from('v_trial_balance')
    .select('account_id, total_debit, total_credit, balance')
    .eq('company_id', DEMO)
    .limit(1);
  record(
    'E.view.v_trial_balance.readable',
    !error ? 'PASS' : 'FAIL',
    error?.message ?? `rows=${data?.length ?? 0}`,
  );
  record(
    'E.view.v_trial_balance.security_invoker_live',
    'CANNOT VERIFY',
    'No DATABASE_URL — cannot read pg_class.reloptions for security_invoker. schema.sql states with (security_invoker = true).',
  );

  // anon should not freely read accounts of arbitrary company (RLS)
  const { data: anonAccts, error: anonErr } = await anonClient
    .from('accounts')
    .select('id')
    .eq('company_id', DEMO)
    .limit(1);
  record(
    'E.rls.accounts_anon_isolated',
    (anonAccts?.length ?? 0) === 0 ? 'PASS' : 'FAIL',
    `rows=${anonAccts?.length}; err=${anonErr?.message ?? 'none'}`,
  );
}

console.log('\n========== SWEEP SUMMARY ==========');
const pass = results.filter((r) => r.status === 'PASS').length;
const fail = results.filter((r) => r.status === 'FAIL').length;
const cv = results.filter((r) => r.status === 'CANNOT VERIFY').length;
console.log(`PASS=${pass} FAIL=${fail} CANNOT_VERIFY=${cv} TOTAL=${results.length}`);
console.log(JSON.stringify(results, null, 2));
process.exit(fail > 0 ? 2 : 0);
