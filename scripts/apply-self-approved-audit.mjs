/**
 * Apply #55 log_journal_entry_change self-approval notes to a live Supabase DB.
 * Requires DATABASE_URL, or prints SQL for the Supabase SQL Editor.
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env.local') });

const sql = `
create or replace function log_journal_entry_change()
returns trigger as $$
declare
  v_notes text := null;
begin
  if tg_op = 'INSERT' then
    insert into audit_log (company_id, table_name, record_id, action, actor_id, new_data)
      values (new.company_id, 'journal_entries', new.id, 'insert'::audit_action, new.created_by, to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    if new.approved_by is not null
       and new.approved_by = new.created_by
       and new.status in ('approved', 'posted')
       and old.status is distinct from new.status
       and old.status not in ('approved', 'posted') then
      v_notes := 'Self-approved by Owner';
    end if;

    insert into audit_log (company_id, table_name, record_id, action, actor_id, old_data, new_data, notes)
      values (new.company_id, 'journal_entries', new.id,
        (case when new.status = 'reversed' then 'reversal' else 'status_change' end)::audit_action,
        coalesce(new.approved_by, new.created_by), to_jsonb(old), to_jsonb(new), v_notes);
  end if;
  return new;
end;
$$ language plpgsql
   set search_path = public, pg_temp;
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
console.log('Applied #55 log_journal_entry_change self-approval notes.');
