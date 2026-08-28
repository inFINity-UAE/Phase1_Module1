/**
 * Apply decision #48 trigger-function EXECUTE grants on live Supabase.
 *
 * Auth (first match wins):
 *   SUPABASE_ACCESS_TOKEN=sbp_...  → Management API
 *   DATABASE_URL=postgresql://...    → direct pg
 *
 * Usage: node scripts/apply-trigger-function-grants.mjs
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env.local') });

const PROJECT_REF = 'hilaeuvltstgedlpgjcw';
const SQL_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../docs/source-of-truth/apply_trigger_function_grants.sql',
);
const rawSql = readFileSync(SQL_PATH, 'utf8');
const applySql = rawSql.replace(/-- Verification:[\s\S]*/m, '').trim();
const verifySql = `
select routine_name, grantee, privilege_type
  from information_schema.role_routine_grants
 where specific_schema = 'public'
   and routine_name in (
     'enforce_account_number_category',
     'enforce_account_hierarchy_depth',
     'prevent_account_deletion',
     'enforce_journal_balance_on_post',
     'prevent_posted_line_mutation',
     'prevent_posted_entry_deletion',
     'prevent_nondraft_header_mutation',
     'block_audit_log_mutation',
     'log_journal_entry_change'
   )
 order by routine_name, grantee;
`;

async function applyViaManagementApi(token) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: applySql }),
    },
  );
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Management API ${res.status}: ${body.slice(0, 400)}`);
  }
  const verifyRes = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: verifySql }),
    },
  );
  const verifyBody = await verifyRes.json();
  if (!verifyRes.ok) {
    throw new Error(`Verify failed ${verifyRes.status}: ${JSON.stringify(verifyBody).slice(0, 400)}`);
  }
  return verifyBody;
}

async function applyViaPg(dsn) {
  const { Client } = pg;
  const client = new Client(
    dsn.startsWith('postgresql')
      ? { connectionString: dsn, ssl: { rejectUnauthorized: false } }
      : { ...dsn, ssl: { rejectUnauthorized: false } },
  );
  await client.connect();
  await client.query(applySql);
  const { rows } = await client.query(verifySql);
  await client.end();
  return rows;
}

function printVerification(rows) {
  console.log('\n=== role_routine_grants verification ===');
  for (const row of rows) {
    console.log(`${row.routine_name}\t${row.grantee}\t${row.privilege_type}`);
  }
  const bad = rows.filter(
    (r) => r.grantee === 'anon' || r.grantee === 'authenticated' || r.grantee === 'PUBLIC',
  );
  if (bad.length) {
    console.error('\nUNEXPECTED grants for anon/authenticated/PUBLIC:', bad);
    process.exit(1);
  }
  const names = new Set(rows.map((r) => r.routine_name));
  const expected = 9;
  if (names.size !== expected) {
    console.error(`Expected ${expected} functions in grants output, got ${names.size}`);
    process.exit(1);
  }
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
const dsn = process.env.DATABASE_URL;

if (token) {
  console.log('Applying via Supabase Management API...');
  const result = await applyViaManagementApi(token);
  const rows = Array.isArray(result) ? result : result?.result ?? result?.rows ?? result;
  printVerification(rows);
} else if (dsn) {
  console.log('Applying via DATABASE_URL...');
  const rows = await applyViaPg(dsn);
  printVerification(rows);
} else {
  console.error('Need SUPABASE_ACCESS_TOKEN or DATABASE_URL');
  process.exit(1);
}

console.log('\nApply complete.');
