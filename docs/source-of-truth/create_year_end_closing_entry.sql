-- create_year_end_closing_entry.sql
-- Apply AFTER allocate_next_entry_number.sql.
--
-- [feature-spec.md decision #4] One year_end_closing per company per fiscal year.
-- [Rules §4.11] Transfer P&L into Retained Earnings (3100).
-- [race fix] Lock → existence check → build P&L lines → allocate → insert → post
-- in ONE transaction under pg_advisory_xact_lock keyed on
-- hashtext('ye:' || company_id || ':' || fiscal_year).
-- Lock order: ALWAYS acquire the 'ye:' lock FIRST, then allocate_next_entry_number's
-- company-scoped lock. 'ob:' and 'ye:' namespaces do NOT block each other.
--
-- Exception tokens (Nest maps these):
--   YEAR_END_ALREADY_CLOSED
--   NO_PERIOD_FOR_FISCAL_YEAR — latest period for FY missing (any status).
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
        'Year-end close — zero income balance'
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
        'Year-end close — zero expense balance'
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
      'Year-end close — net P&L to Retained Earnings'
    );
  elsif v_net < 0 then
    insert into tmp_ye_lines(line_number, account_id, debit, credit, description)
    values (
      v_line_number,
      v_re_id,
      abs(v_net),
      0,
      'Year-end close — net P&L to Retained Earnings'
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
