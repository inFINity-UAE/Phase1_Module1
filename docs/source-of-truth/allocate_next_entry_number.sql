-- allocate_next_entry_number.sql
-- Apply in Supabase SQL editor, then keep in sync with schema.sql.
--
-- [HANDOFF §7 / race fix] Company-scoped transaction advisory lock around
-- max(entry_number)+1 so concurrent creates for the SAME company serialize
-- on allocation while different companies remain concurrent.
-- Callers that insert must invoke this INSIDE the same transaction as the
-- INSERT (as insert_journal_entry_draft / create_* / reverse_journal_entry do).
--
-- [feature-spec.md decision #10] service_role only.

create or replace function allocate_next_entry_number(p_company_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_next bigint;
begin
  -- Transaction-scoped; released automatically at COMMIT/ROLLBACK.
  perform pg_advisory_xact_lock(hashtext(p_company_id::text));

  select coalesce(max(entry_number), 0) + 1
    into v_next
    from journal_entries
   where company_id = p_company_id;

  return v_next;
end;
$$;

revoke all on function allocate_next_entry_number(uuid) from public;
revoke all on function allocate_next_entry_number(uuid) from authenticated;
revoke all on function allocate_next_entry_number(uuid) from anon;
grant execute on function allocate_next_entry_number(uuid) to service_role;

-- Verify grants after apply:
-- select grantee, privilege_type
--   from information_schema.role_routine_grants
--  where routine_schema = 'public'
--    and routine_name = 'allocate_next_entry_number';
