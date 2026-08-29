/**
 * Apply #56 trigger tokens + audit_action enum value to a live Supabase DB.
 * Requires DATABASE_URL (Postgres connection string) in .env.local.
 *
 * Fresh DBs: prefer schema.sql top-to-bottom instead.
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env.local') });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'DATABASE_URL is not set. Paste the SQL below into the Supabase SQL Editor, or set DATABASE_URL and re-run.\n',
  );
  console.log(`alter type audit_action add value if not exists 'delete_blocked';

create or replace function prevent_posted_line_mutation()
returns trigger as $$
declare
  entry_status journal_entry_status;
begin
  select status into entry_status from journal_entries
    where id = coalesce(new.journal_entry_id, old.journal_entry_id);
  if entry_status = 'posted' then
    if tg_op = 'DELETE' then
      raise exception 'POSTED_LINE_DELETE_BLOCKED';
    end if;
    raise exception 'Cannot modify lines of a posted journal entry — reverse it instead';
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql
   set search_path = public, pg_temp;

create or replace function prevent_posted_entry_deletion()
returns trigger as $$
begin
  if old.status = 'posted' then
    raise exception 'POSTED_ENTRY_DELETE_BLOCKED';
  end if;
  return old;
end;
$$ language plpgsql
   set search_path = public, pg_temp;
`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(`alter type audit_action add value if not exists 'delete_blocked'`);
await client.query(`
create or replace function prevent_posted_line_mutation()
returns trigger as $$
declare
  entry_status journal_entry_status;
begin
  select status into entry_status from journal_entries
    where id = coalesce(new.journal_entry_id, old.journal_entry_id);
  if entry_status = 'posted' then
    if tg_op = 'DELETE' then
      raise exception 'POSTED_LINE_DELETE_BLOCKED';
    end if;
    raise exception 'Cannot modify lines of a posted journal entry — reverse it instead';
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql
   set search_path = public, pg_temp;
`);
await client.query(`
create or replace function prevent_posted_entry_deletion()
returns trigger as $$
begin
  if old.status = 'posted' then
    raise exception 'POSTED_ENTRY_DELETE_BLOCKED';
  end if;
  return old;
end;
$$ language plpgsql
   set search_path = public, pg_temp;
`);
await client.end();
console.log('Applied #56 enum + trigger tokens.');
