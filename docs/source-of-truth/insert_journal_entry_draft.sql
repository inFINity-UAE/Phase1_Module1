-- insert_journal_entry_draft.sql
-- Apply AFTER allocate_next_entry_number.sql.
-- Atomic draft insert: advisory-locked entry_number + entry + lines + attachments.
-- Used by Nest insertDraft (manual) and insertGeneratedFromTemplate (recurring).
--
-- [feature-spec.md decision #10] service_role only.

create or replace function insert_journal_entry_draft(
  p_company_id uuid,
  p_period_id uuid,
  p_entry_date date,
  p_entry_type journal_entry_type,
  p_narration text,
  p_created_by uuid,
  p_lines jsonb,
  p_reference_number text default null,
  p_recurring_template_id uuid default null,
  p_attachments jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry_number bigint;
  v_entry        journal_entries%rowtype;
  v_lines        jsonb;
  v_attachments  jsonb;
  v_line         jsonb;
  v_att          jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'JOURNAL_DRAFT_REQUIRES_LINES';
  end if;

  -- Nested company lock (released with this transaction).
  v_entry_number := allocate_next_entry_number(p_company_id);

  insert into journal_entries (
    company_id,
    entry_number,
    period_id,
    entry_date,
    entry_type,
    status,
    narration,
    reference_number,
    recurring_template_id,
    created_by
  ) values (
    p_company_id,
    v_entry_number,
    p_period_id,
    p_entry_date,
    p_entry_type,
    'draft',
    p_narration,
    p_reference_number,
    p_recurring_template_id,
    p_created_by
  )
  returning * into v_entry;

  for v_line in
    select value from jsonb_array_elements(p_lines) as t(value)
    order by (value->>'line_number')::int
  loop
    insert into journal_lines (
      journal_entry_id,
      line_number,
      account_id,
      debit,
      credit,
      description,
      cost_center
    ) values (
      v_entry.id,
      (v_line->>'line_number')::int,
      (v_line->>'account_id')::uuid,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      nullif(v_line->>'description', ''),
      nullif(v_line->>'cost_center', '')
    );
  end loop;

  if p_attachments is not null
     and jsonb_typeof(p_attachments) = 'array'
     and jsonb_array_length(p_attachments) > 0 then
    for v_att in select value from jsonb_array_elements(p_attachments) as t(value) loop
      insert into journal_attachments (
        journal_entry_id,
        file_name,
        file_url,
        file_size_bytes,
        uploaded_by
      ) values (
        v_entry.id,
        v_att->>'file_name',
        v_att->>'file_url',
        nullif(v_att->>'file_size_bytes', '')::bigint,
        p_created_by
      );
    end loop;
  end if;

  select coalesce(jsonb_agg(to_jsonb(jl) order by jl.line_number), '[]'::jsonb)
    into v_lines
    from journal_lines jl
   where jl.journal_entry_id = v_entry.id;

  select coalesce(jsonb_agg(to_jsonb(ja) order by ja.uploaded_at), '[]'::jsonb)
    into v_attachments
    from journal_attachments ja
   where ja.journal_entry_id = v_entry.id;

  return jsonb_build_object(
    'entry', to_jsonb(v_entry),
    'lines', v_lines,
    'attachments', v_attachments
  );
end;
$$;

revoke all on function insert_journal_entry_draft(uuid, uuid, date, journal_entry_type, text, uuid, jsonb, text, uuid, jsonb) from public;
revoke all on function insert_journal_entry_draft(uuid, uuid, date, journal_entry_type, text, uuid, jsonb, text, uuid, jsonb) from authenticated;
revoke all on function insert_journal_entry_draft(uuid, uuid, date, journal_entry_type, text, uuid, jsonb, text, uuid, jsonb) from anon;
grant execute on function insert_journal_entry_draft(uuid, uuid, date, journal_entry_type, text, uuid, jsonb, text, uuid, jsonb) to service_role;

-- Verify grants after apply:
-- select grantee, privilege_type
--   from information_schema.role_routine_grants
--  where routine_schema = 'public'
--    and routine_name = 'insert_journal_entry_draft';
