-- reverse_journal_entry.sql
-- Apply to live Supabase (SQL editor) if not already deployed from schema.sql §10.
-- Atomic reversal: draft → lines → post → mark original reversed, one transaction.
--
-- [feature-spec.md decision #9] A reversal entry cannot itself be reversed —
-- enforced below by the entry_type = 'reversal' check.
-- [feature-spec.md decision #10] This function is service_role-only. It is
-- SECURITY DEFINER and therefore bypasses RLS entirely — granting execute
-- to `authenticated` would let any logged-in user, from any company, pass
-- an arbitrary p_original_id and reverse another company's journal entry.
-- The NestJS backend is the only intended caller, and must derive
-- p_created_by from the authenticated request's own session — never from
-- a client-supplied field — since this function has no RLS safety net of
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

  select coalesce(max(entry_number), 0) + 1
    into v_entry_number
    from journal_entries
   where company_id = v_original.company_id;

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

-- [feature-spec.md decision #10] service_role only — SECURITY DEFINER
-- bypasses RLS, so this must never be reachable by `authenticated` or
-- `public`, only the trusted backend.
revoke all on function reverse_journal_entry(uuid, uuid, boolean) from public;
revoke all on function reverse_journal_entry(uuid, uuid, boolean) from authenticated;
grant execute on function reverse_journal_entry(uuid, uuid, boolean) to service_role;