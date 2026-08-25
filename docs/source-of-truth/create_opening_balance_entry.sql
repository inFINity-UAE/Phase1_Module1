-- create_opening_balance_entry.sql
-- Apply AFTER allocate_next_entry_number.sql.
--
-- [feature-spec.md decision #3] One opening_balance per company per fiscal year.
-- [race fix] Entire check → find period → allocate entry_number → insert → post
-- runs in ONE transaction under pg_advisory_xact_lock keyed on
-- hashtext('ob:' || company_id || ':' || fiscal_year) so concurrent creates
-- for the same company+FY serialize; different companies / FYs stay concurrent.
-- Lock order: ALWAYS acquire the 'ob:' lock FIRST, then allocate_next_entry_number's
-- company-scoped lock (avoids deadlock with other entry inserts).
--
-- Exception tokens (Nest maps these):
--   OPENING_BALANCE_ALREADY_EXISTS
--   NO_OPEN_PERIOD_FOR_FISCAL_YEAR  — earliest *open* period lookup failed
--     (distinct from year-end's NO_PERIOD_FOR_FISCAL_YEAR, which is any period)
--
-- [feature-spec.md decision #10] service_role only.

create or replace function create_opening_balance_entry(
  p_company_id uuid,
  p_fiscal_year integer,
  p_entry_date date,
  p_narration text,
  p_created_by uuid,
  p_lines jsonb,
  p_reference_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period       accounting_periods%rowtype;
  v_entry_number bigint;
  v_entry        journal_entries%rowtype;
  v_lines        jsonb;
  v_line         jsonb;
  v_exists       boolean;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'JOURNAL_DRAFT_REQUIRES_LINES';
  end if;

  -- Outer lock first (before any company entry-number lock).
  perform pg_advisory_xact_lock(
    hashtext('ob:' || p_company_id::text || ':' || p_fiscal_year::text)
  );

  select exists (
    select 1
      from journal_entries je
      join accounting_periods ap on ap.id = je.period_id
     where je.company_id = p_company_id
       and ap.fiscal_year = p_fiscal_year
       and je.entry_type = 'opening_balance'
     limit 1
  ) into v_exists;

  if v_exists then
    raise exception 'OPENING_BALANCE_ALREADY_EXISTS';
  end if;

  -- Opening balance requires an *open* period (Nest: findEarliestOpenPeriod).
  -- Token: NO_OPEN_PERIOD_FOR_FISCAL_YEAR (not NO_PERIOD_FOR_FISCAL_YEAR).
  select * into v_period
    from accounting_periods
   where company_id = p_company_id
     and fiscal_year = p_fiscal_year
     and status = 'open'
   order by period_start
   limit 1;

  if not found then
    raise exception 'NO_OPEN_PERIOD_FOR_FISCAL_YEAR';
  end if;

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
    created_by
  ) values (
    p_company_id,
    v_entry_number,
    v_period.id,
    p_entry_date,
    'opening_balance',
    'draft',
    p_narration,
    p_reference_number,
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

  update journal_entries
     set status = 'posted'
   where id = v_entry.id
     and status = 'draft'
  returning * into v_entry;

  if not found then
    raise exception 'Failed to post opening balance entry %', v_entry_number;
  end if;

  select coalesce(jsonb_agg(to_jsonb(jl) order by jl.line_number), '[]'::jsonb)
    into v_lines
    from journal_lines jl
   where jl.journal_entry_id = v_entry.id;

  return jsonb_build_object(
    'entry', to_jsonb(v_entry),
    'lines', v_lines,
    'attachments', '[]'::jsonb
  );
end;
$$;

revoke all on function create_opening_balance_entry(uuid, integer, date, text, uuid, jsonb, text) from public;
revoke all on function create_opening_balance_entry(uuid, integer, date, text, uuid, jsonb, text) from authenticated;
revoke all on function create_opening_balance_entry(uuid, integer, date, text, uuid, jsonb, text) from anon;
grant execute on function create_opening_balance_entry(uuid, integer, date, text, uuid, jsonb, text) to service_role;

-- Verify grants after apply:
-- select grantee, privilege_type
--   from information_schema.role_routine_grants
--  where routine_schema = 'public'
--    and routine_name = 'create_opening_balance_entry';
