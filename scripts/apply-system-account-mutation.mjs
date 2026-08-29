/**
 * Apply #58 prevent_system_account_mutation to a live Supabase DB.
 * Requires DATABASE_URL, or prints SQL for the Supabase SQL Editor.
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env.local') });

const sql = `
create or replace function prevent_system_account_mutation()
returns trigger as $$
begin
  if not old.is_system_account then
    return new;
  end if;

  if new.account_number is distinct from old.account_number
     or new.category is distinct from old.category
     or new.normal_balance is distinct from old.normal_balance
     or new.parent_account_id is distinct from old.parent_account_id
     or new.depth is distinct from old.depth
     or new.is_system_account is distinct from old.is_system_account
     or new.company_id is distinct from old.company_id
     or new.is_active is distinct from old.is_active then
    raise exception 'System accounts cannot change structural or identity fields — update account_name, sub_category, or description only';
  end if;

  return new;
end;
$$ language plpgsql
   set search_path = public, pg_temp;

drop trigger if exists trg_prevent_system_account_mutation on accounts;
create trigger trg_prevent_system_account_mutation
  before update on accounts
  for each row execute function prevent_system_account_mutation();

revoke all on function prevent_system_account_mutation() from public;
revoke all on function prevent_system_account_mutation() from authenticated;
revoke all on function prevent_system_account_mutation() from anon;
grant execute on function prevent_system_account_mutation() to service_role;
`;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'DATABASE_URL is not set. Paste the SQL below into the Supabase SQL Editor, or set DATABASE_URL and re-run.\n',
  );
  console.log(sql);
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(sql);
await client.end();
console.log('Applied #58 prevent_system_account_mutation.');
