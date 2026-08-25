-- apply_advisory_lock_journal_rpcs_bundle.sql
-- Paste/run this entire file in the Supabase SQL editor (one shot).
-- Does NOT alter table/column/constraint definitions.

-- ========== allocate_next_entry_number.sql ==========
-- allocate_next_entry_number.sql
-- Apply in Supabase SQL editor, then keep in sync with schema.sql.
--
-- [HANDOFF Â§7 / race fix] Company-scoped transaction advisory lock around
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


-- ========== insert_journal_entry_draft.sql ==========
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


-- ========== create_opening_balance_entry.sql ==========
-- create_opening_balance_entry.sql
-- Apply AFTER allocate_next_entry_number.sql.
--
-- [feature-spec.md decision #3] One opening_balance per company per fiscal year.
-- [race fix] Entire check â†’ find period â†’ allocate entry_number â†’ insert â†’ post
-- runs in ONE transaction under pg_advisory_xact_lock keyed on
-- hashtext('ob:' || company_id || ':' || fiscal_year) so concurrent creates
-- for the same company+FY serialize; different companies / FYs stay concurrent.
-- Lock order: ALWAYS acquire the 'ob:' lock FIRST, then allocate_next_entry_number's
-- company-scoped lock (avoids deadlock with other entry inserts).
--
-- Exception tokens (Nest maps these):
--   OPENING_BALANCE_ALREADY_EXISTS
--   NO_OPEN_PERIOD_FOR_FISCAL_YEAR  â€” earliest *open* period lookup failed
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


-- ========== create_year_end_closing_entry.sql ==========
-- create_year_end_closing_entry.sql
-- Apply AFTER allocate_next_entry_number.sql.
--
-- [feature-spec.md decision #4] One year_end_closing per company per fiscal year.
-- [Rules Â§4.11] Transfer P&L into Retained Earnings (3100).
-- [race fix] Lock â†’ existence check â†’ build P&L lines â†’ allocate â†’ insert â†’ post
-- in ONE transaction under pg_advisory_xact_lock keyed on
-- hashtext('ye:' || company_id || ':' || fiscal_year).
-- Lock order: ALWAYS acquire the 'ye:' lock FIRST, then allocate_next_entry_number's
-- company-scoped lock. 'ob:' and 'ye:' namespaces do NOT block each other.
--
-- Exception tokens (Nest maps these):
--   YEAR_END_ALREADY_CLOSED
--   NO_PERIOD_FOR_FISCAL_YEAR â€” latest period for FY missing (any status).
--     Distinct from opening-balance's NO_OPEN_PERIOD_FOR_FISCAL_YEAR
--     (which requires status = 'open').
--   RETAINED_EARNINGS_NOT_FOUND
--   NO_PL_BALANCES_TO_CLOSE
--
-- [feature-spec.md decision #10] service_role only.

create or replace function create_year_end_closing_entry(
  p_company_id uuid,
  p_fiscal_year integer,
  p_created_by uuid,
  p_entry_date date default null,
  p_narration text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period              accounting_periods%rowtype;
  v_re_id               uuid;
  v_entry_number        bigint;
  v_entry               journal_entries%rowtype;
  v_lines_json          jsonb;
  v_exists              boolean;
  v_entry_date          date;
  v_narration           text;
  v_line_number         int := 1;
  v_total_debits        numeric(18,2) := 0;
  v_total_credits       numeric(18,2) := 0;
  v_net                 numeric(18,2);
  r                     record;
begin
  perform pg_advisory_xact_lock(
    hashtext('ye:' || p_company_id::text || ':' || p_fiscal_year::text)
  );

  select exists (
    select 1
      from journal_entries je
      join accounting_periods ap on ap.id = je.period_id
     where je.company_id = p_company_id
       and ap.fiscal_year = p_fiscal_year
       and je.entry_type = 'year_end_closing'
     limit 1
  ) into v_exists;

  if v_exists then
    raise exception 'YEAR_END_ALREADY_CLOSED';
  end if;

  -- Year-end uses latest period for the FY regardless of open/closed status.
  -- Token: NO_PERIOD_FOR_FISCAL_YEAR (not NO_OPEN_PERIOD_FOR_FISCAL_YEAR).
  select * into v_period
    from accounting_periods
   where company_id = p_company_id
     and fiscal_year = p_fiscal_year
   order by period_end desc
   limit 1;

  if not found then
    raise exception 'NO_PERIOD_FOR_FISCAL_YEAR';
  end if;

  select id into v_re_id
    from accounts
   where company_id = p_company_id
     and account_number = '3100'
     and is_system_account = true
   limit 1;

  if v_re_id is null then
    raise exception 'RETAINED_EARNINGS_NOT_FOUND';
  end if;

  -- Build closing lines from posted P&L balances for this company+FY
  -- (mirrors Nest getProfitAndLossBalancesForFiscalYear + buildYearEndClosingLines).
  create temporary table tmp_ye_lines (
    line_number int primary key,
    account_id uuid not null,
    debit numeric(18,2) not null default 0,
    credit numeric(18,2) not null default 0,
    description text
  ) on commit drop;

  for r in
    select
      a.id as account_id,
      a.category,
      a.normal_balance,
      round(sum(jl.debit)::numeric, 2) as total_debit,
      round(sum(jl.credit)::numeric, 2) as total_credit,
      case
        when a.normal_balance = 'debit' then
          round((sum(jl.debit) - sum(jl.credit))::numeric, 2)
        else
          round((sum(jl.credit) - sum(jl.debit))::numeric, 2)
      end as balance
    from journal_lines jl
    join journal_entries je on je.id = jl.journal_entry_id
    join accounting_periods ap on ap.id = je.period_id
    join accounts a on a.id = jl.account_id
   where je.company_id = p_company_id
     and je.status = 'posted'
     and ap.fiscal_year = p_fiscal_year
     and a.category in ('income', 'expense')
   group by a.id, a.category, a.normal_balance
  having case
           when a.normal_balance = 'debit' then
             round((sum(jl.debit) - sum(jl.credit))::numeric, 2)
           else
             round((sum(jl.credit) - sum(jl.debit))::numeric, 2)
         end <> 0
  loop
    if r.category = 'income' then
      insert into tmp_ye_lines(line_number, account_id, debit, credit, description)
      values (
        v_line_number,
        r.account_id,
        r.balance,
        0,
        'Year-end close â€” zero income balance'
      );
      v_total_debits := v_total_debits + r.balance;
      v_line_number := v_line_number + 1;
    elsif r.category = 'expense' then
      insert into tmp_ye_lines(line_number, account_id, debit, credit, description)
      values (
        v_line_number,
        r.account_id,
        0,
        r.balance,
        'Year-end close â€” zero expense balance'
      );
      v_total_credits := v_total_credits + r.balance;
      v_line_number := v_line_number + 1;
    end if;
  end loop;

  if not exists (select 1 from tmp_ye_lines) then
    raise exception 'NO_PL_BALANCES_TO_CLOSE';
  end if;

  v_net := round((v_total_debits - v_total_credits)::numeric, 2);
  if v_net > 0 then
    insert into tmp_ye_lines(line_number, account_id, debit, credit, description)
    values (
      v_line_number,
      v_re_id,
      0,
      v_net,
      'Year-end close â€” net P&L to Retained Earnings'
    );
  elsif v_net < 0 then
    insert into tmp_ye_lines(line_number, account_id, debit, credit, description)
    values (
      v_line_number,
      v_re_id,
      abs(v_net),
      0,
      'Year-end close â€” net P&L to Retained Earnings'
    );
  end if;

  v_entry_date := coalesce(p_entry_date, v_period.period_end);
  v_narration := coalesce(
    nullif(trim(p_narration), ''),
    format('Year-end closing for fiscal year %s', p_fiscal_year)
  );

  v_entry_number := allocate_next_entry_number(p_company_id);

  insert into journal_entries (
    company_id,
    entry_number,
    period_id,
    entry_date,
    entry_type,
    status,
    narration,
    created_by
  ) values (
    p_company_id,
    v_entry_number,
    v_period.id,
    v_entry_date,
    'year_end_closing',
    'draft',
    v_narration,
    p_created_by
  )
  returning * into v_entry;

  insert into journal_lines (
    journal_entry_id,
    line_number,
    account_id,
    debit,
    credit,
    description
  )
  select
    v_entry.id,
    t.line_number,
    t.account_id,
    t.debit,
    t.credit,
    t.description
  from tmp_ye_lines t
  order by t.line_number;

  update journal_entries
     set status = 'posted'
   where id = v_entry.id
     and status = 'draft'
  returning * into v_entry;

  if not found then
    raise exception 'Failed to post year-end closing entry %', v_entry_number;
  end if;

  select coalesce(jsonb_agg(to_jsonb(jl) order by jl.line_number), '[]'::jsonb)
    into v_lines_json
    from journal_lines jl
   where jl.journal_entry_id = v_entry.id;

  return jsonb_build_object(
    'entry', to_jsonb(v_entry),
    'lines', v_lines_json,
    'attachments', '[]'::jsonb
  );
end;
$$;

revoke all on function create_year_end_closing_entry(uuid, integer, uuid, date, text) from public;
revoke all on function create_year_end_closing_entry(uuid, integer, uuid, date, text) from authenticated;
revoke all on function create_year_end_closing_entry(uuid, integer, uuid, date, text) from anon;
grant execute on function create_year_end_closing_entry(uuid, integer, uuid, date, text) to service_role;

-- Verify grants after apply:
-- select grantee, privilege_type
--   from information_schema.role_routine_grants
--  where routine_schema = 'public'
--    and routine_name = 'create_year_end_closing_entry';


-- ========== reverse_journal_entry.sql ==========
-- reverse_journal_entry.sql
-- Apply to live Supabase (SQL editor) if not already deployed from schema.sql Â§10.
-- Atomic reversal: draft â†’ lines â†’ post â†’ mark original reversed, one transaction.
--
-- [feature-spec.md decision #9] A reversal entry cannot itself be reversed â€”
-- enforced below by the entry_type = 'reversal' check.
-- [feature-spec.md decision #10] This function is service_role-only. It is
-- SECURITY DEFINER and therefore bypasses RLS entirely â€” granting execute
-- to `authenticated` would let any logged-in user, from any company, pass
-- an arbitrary p_original_id and reverse another company's journal entry.
-- The NestJS backend is the only intended caller, and must derive
-- p_created_by from the authenticated request's own session â€” never from
-- a client-supplied field â€” since this function has no RLS safety net of
-- its own.

create or replace function reverse_journal_entry(
  p_original_id uuid,
  p_created_by uuid,
  p_fail_before_original_update boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_original          journal_entries%rowtype;
  v_original_period   accounting_periods%rowtype;
  v_next_period       accounting_periods%rowtype;
  v_entry_number      bigint;
  v_reversal          journal_entries%rowtype;
  v_updated_original  journal_entries%rowtype;
  v_reversal_lines    jsonb;
begin
  select * into v_original
    from journal_entries
   where id = p_original_id
   for update;

  if not found then
    raise exception 'Journal entry % not found', p_original_id;
  end if;

  if v_original.status = 'reversed' or v_original.reversed_by_entry_id is not null then
    raise exception 'Journal entry % has already been reversed and cannot be reversed again',
      v_original.entry_number;
  end if;

  if v_original.status <> 'posted' then
    raise exception 'Journal entry % must be posted before it can be reversed',
      v_original.entry_number;
  end if;

  -- [feature-spec.md decision #9] reversal-of-a-reversal is blocked
  if v_original.entry_type = 'reversal' or v_original.reverses_entry_id is not null then
    raise exception 'Journal entry % is a reversal entry and cannot be reversed',
      v_original.entry_number;
  end if;

  select * into v_original_period
    from accounting_periods
   where id = v_original.period_id;

  if not found then
    raise exception 'Accounting period % not found', v_original.period_id;
  end if;

  select * into v_next_period
    from accounting_periods
   where company_id = v_original.company_id
     and status = 'open'
     and period_start > v_original_period.period_end
   order by period_start
   limit 1;

  if not found then
    raise exception 'NO_NEXT_OPEN_PERIOD';
  end if;

  -- [race fix] Same company-scoped advisory lock as all other entry inserts.
  -- Requires allocate_next_entry_number to be applied first.
  v_entry_number := allocate_next_entry_number(v_original.company_id);

  insert into journal_entries (
    company_id,
    entry_number,
    period_id,
    entry_date,
    entry_type,
    status,
    narration,
    reference_number,
    reverses_entry_id,
    created_by
  ) values (
    v_original.company_id,
    v_entry_number,
    v_next_period.id,
    v_next_period.period_start,
    'reversal',
    'draft',
    format('Reversal of journal entry %s', v_original.entry_number),
    v_original.reference_number,
    p_original_id,
    p_created_by
  )
  returning * into v_reversal;

  insert into journal_lines (
    journal_entry_id,
    line_number,
    account_id,
    debit,
    credit,
    description,
    cost_center
  )
  select
    v_reversal.id,
    jl.line_number,
    jl.account_id,
    jl.credit,
    jl.debit,
    jl.description,
    jl.cost_center
  from journal_lines jl
  where jl.journal_entry_id = p_original_id
  order by jl.line_number;

  update journal_entries
     set status = 'posted'
   where id = v_reversal.id
     and status = 'draft'
  returning * into v_reversal;

  if not found then
    raise exception 'Failed to post reversal entry %', v_entry_number;
  end if;

  if p_fail_before_original_update then
    raise exception 'SIMULATED_REVERSAL_FAILURE: forced before original update';
  end if;

  update journal_entries
     set status = 'reversed',
         reversed_by_entry_id = v_reversal.id
   where id = p_original_id
     and status = 'posted'
     and reversed_by_entry_id is null
  returning * into v_updated_original;

  if not found then
    raise exception 'Failed to mark journal entry % as reversed', v_original.entry_number;
  end if;

  select coalesce(jsonb_agg(to_jsonb(jl) order by jl.line_number), '[]'::jsonb)
    into v_reversal_lines
    from journal_lines jl
   where jl.journal_entry_id = v_reversal.id;

  return jsonb_build_object(
    'original', to_jsonb(v_updated_original),
    'reversal', to_jsonb(v_reversal),
    'reversal_lines', v_reversal_lines
  );
end;
$$;

-- [feature-spec.md decision #10] service_role only â€” SECURITY DEFINER
-- bypasses RLS, so this must never be reachable by `authenticated`,
-- `anon`, or `public`, only the trusted backend.
--
-- NOTE: Supabase auto-grants EXECUTE on every new public-schema function
-- to anon, authenticated, AND service_role at creation time. The revokes
-- below must be explicit and complete â€” a first pass at this file missed
-- `anon`, which is worse than missing `authenticated` (anon = fully
-- unauthenticated callers). See feature-spec.md decision #10's
-- 2026-08-23 correction for the full story.
revoke all on function reverse_journal_entry(uuid, uuid, boolean) from public;
revoke all on function reverse_journal_entry(uuid, uuid, boolean) from authenticated;
revoke all on function reverse_journal_entry(uuid, uuid, boolean) from anon;
grant execute on function reverse_journal_entry(uuid, uuid, boolean) to service_role;

-- Schema-level hardening so this class of bug can't recur silently on
-- future functions: new public-schema functions no longer auto-grant to
-- anon/authenticated by default. Explicit grant required going forward.
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from authenticated;

-- ========== grant verification ==========
select routine_name, grantee, privilege_type
  from information_schema.role_routine_grants
 where routine_schema = 'public'
   and routine_name in (
     'allocate_next_entry_number',
     'insert_journal_entry_draft',
     'create_opening_balance_entry',
     'create_year_end_closing_entry',
     'reverse_journal_entry'
   )
 order by routine_name, grantee;

