import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env.local') });

const DEMO = '00000000-0000-0000-0000-000000000002';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const client = createClient(url, key);

function prefixOk(s) {
  const d = s.account_number[0];
  return (
    (s.category === 'asset' && d === '1') ||
    (s.category === 'liability' && d === '2') ||
    (s.category === 'equity' && d === '3') ||
    (s.category === 'income' && d === '4') ||
    (s.category === 'expense' && d === '5')
  );
}

const { data: seed, error } = await client
  .from('accounts')
  .select('*')
  .eq('company_id', DEMO);
if (error) throw error;

const byId = Object.fromEntries(seed.map((a) => [a.id, a]));
const nums = {};
for (const a of seed) nums[a.account_number] = (nums[a.account_number] || 0) + 1;
const dupN = Object.keys(nums).filter((n) => nums[n] > 1);
const badPrefix = seed.filter((s) => !prefixOk(s));
const badDepth = seed.filter(
  (a) =>
    a.parent_account_id &&
    byId[a.parent_account_id] &&
    a.depth !== byId[a.parent_account_id].depth + 1,
);
const re3100 = seed.filter(
  (a) =>
    a.account_number === '3100' &&
    a.account_name === 'Retained Earnings' &&
    a.is_system_account,
);
const badNorm = seed.filter((a) => !['debit', 'credit'].includes(a.normal_balance));
const hier = seed.filter((a) =>
  ['1021', '1022', '5101', '5102'].includes(a.account_number),
);

const checks = [
  ['total_count', seed.length, seed.length === 183],
  ['no_duplicate_account_numbers', dupN.length, dupN.length === 0],
  ['leading_digit_matches_category', badPrefix.length, badPrefix.length === 0],
  ['parent_depth_plus_one', badDepth.length, badDepth.length === 0],
  ['retained_earnings_3100_system', re3100.length, re3100.length === 1],
  ['normal_balance_lowercase', badNorm.length, badNorm.length === 0],
  ['hierarchy_demo_count', hier.length, hier.length === 4],
];

console.log(JSON.stringify(checks.map(([n, v, p]) => ({ check_name: n, value: String(v), pass: p })), null, 2));
