-- [feature-spec-1_1_D.md §4.5a / D-8 / D-10 / D-15]
-- Monthly ECL provisioning run. Callable RPC only — D-P11 wires T+5 schedule.
-- Guards: ecl: advisory lock, unique (company_id, period_end_date), period not closed.
create or replace function run_ecl_provision(
  p_company_id uuid,
  p_period_end_date date,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period              accounting_periods%rowtype;
  v_as_of               date;
  v_required            numeric(18,2) := 0;
  v_prior               numeric(18,2) := 0;
  v_adjustment          numeric(18,2);
  v_allowance_id        uuid;
  v_expense_id          uuid;
  v_allowance_nb        normal_balance_type;
  v_entry_number        bigint;
  v_entry               journal_entries%rowtype;
  v_journal_entry_id    uuid := null;
  v_run                 ecl_provision_runs%rowtype;
  v_lines               jsonb := '[]'::jsonb;
  v_ref                 text;
  v_missing_bucket      text;
begin
  if p_company_id is null then
    raise exception 'COMPANY_ID_REQUIRED';
  end if;
  if p_period_end_date is null then
    raise exception 'PERIOD_END_DATE_REQUIRED';
  end if;
  if p_created_by is null then
    raise exception 'CREATED_BY_REQUIRED';
  end if;

  -- [§3.7 / §4.5a] Serialize concurrent runs for one company.
  perform acquire_ecl_provision_lock(p_company_id);

  if exists (
    select 1 from ecl_provision_runs
     where company_id = p_company_id
       and period_end_date = p_period_end_date
  ) then
    raise exception 'ECL_PROVISION_ALREADY_RUN';
  end if;

  -- D-15: one calendar month per period; match by month start.
  select * into v_period
    from accounting_periods
   where company_id = p_company_id
     and period_start = date_trunc('month', p_period_end_date)::date;

  if not found then
    raise exception 'ACCOUNTING_PERIOD_NOT_FOUND';
  end if;

  -- [D-10] Loud refuse if already hard-closed — reuse period-status check, not a new workflow.
  if v_period.status = 'closed' then
    raise exception 'ACCOUNTING_PERIOD_CLOSED';
  end if;

  v_as_of := p_period_end_date;

  select id, normal_balance into v_allowance_id, v_allowance_nb
    from accounts
   where company_id = p_company_id
     and account_number = '1110'
     and is_active = true;
  if v_allowance_id is null then
    raise exception 'ECL_POSTING_ACCOUNT_NOT_FOUND';
  end if;

  select id into v_expense_id
    from accounts
   where company_id = p_company_id
     and account_number = '5640'
     and is_active = true;
  if v_expense_id is null then
    raise exception 'ECL_POSTING_ACCOUNT_NOT_FOUND';
  end if;

  -- Active rates: latest effective_from <= as_of per bucket (§4.5a / §3.4a).
  -- Rates are provisional industry midpoints until recalibrated (seed comment).
  with active_rates as (
    select distinct on (bucket) bucket, loss_rate
      from ecl_loss_rate_policies
     where company_id = p_company_id
       and effective_from <= v_as_of
     order by bucket, effective_from desc
  ),
  open_invoices as (
    select
      i.customer_id,
      c.ecl_override_rate,
      (i.grand_total - i.amount_paid)::numeric(18,2) as outstanding,
      case
        when i.due_date is null or (v_as_of - i.due_date) <= 0 then 'current'
        when (v_as_of - i.due_date) between 1 and 30 then '0_30'
        when (v_as_of - i.due_date) between 31 and 60 then '31_60'
        when (v_as_of - i.due_date) between 61 and 90 then '61_90'
        else '90_plus'
      end as bucket
      from invoices i
      join customers c on c.id = i.customer_id
     where i.company_id = p_company_id
       and i.status in ('issued', 'overdue', 'partially_paid')
       and i.amount_paid < i.grand_total
  ),
  -- Override customers: single rate × whole outstanding (step 2).
  override_allowance as (
    select coalesce(sum(round(oi.outstanding * oi.ecl_override_rate, 2)), 0)::numeric(18,2) as amt
      from open_invoices oi
     where oi.ecl_override_rate is not null
  ),
  -- Non-override: D-5 buckets × active policy rates (step 1).
  bucketed as (
    select oi.bucket, sum(oi.outstanding)::numeric(18,2) as bal
      from open_invoices oi
     where oi.ecl_override_rate is null
     group by oi.bucket
  ),
  bucket_allowance as (
    select coalesce(sum(round(b.bal * r.loss_rate, 2)), 0)::numeric(18,2) as amt
      from bucketed b
      join active_rates r on r.bucket = b.bucket
  )
  select
    (select amt from override_allowance) + (select amt from bucket_allowance),
    (
      select b.bucket
        from bucketed b
       where not exists (select 1 from active_rates r where r.bucket = b.bucket)
       limit 1
    )
    into v_required, v_missing_bucket;

  if v_missing_bucket is not null then
    raise exception 'ECL_LOSS_RATE_MISSING';
  end if;

  -- Current 1110 credit balance = prior_allowance (step 3).
  select coalesce(
           account_signed_balance(v_allowance_nb, sum(jl.debit), sum(jl.credit)),
           0
         )
    into v_prior
    from journal_lines jl
    join journal_entries je on je.id = jl.journal_entry_id
   where jl.account_id = v_allowance_id
     and is_ledger_truth_status(je.status);

  v_prior := greatest(coalesce(v_prior, 0), 0);
  v_required := coalesce(v_required, 0);
  v_adjustment := round((v_required - v_prior)::numeric, 2);

  -- Step 4: post only when adjustment <> 0. D-11: ecl_provision is non-blocking — post directly.
  if v_adjustment <> 0 then
    v_ref := 'ecl:' || p_company_id::text || ':' || p_period_end_date::text;
    v_entry_number := allocate_next_entry_number(p_company_id);

    insert into journal_entries (
      company_id, entry_number, period_id, entry_date, entry_type, status,
      narration, reference_number, created_by
    ) values (
      p_company_id, v_entry_number, v_period.id, v_as_of, 'ecl_provision', 'draft',
      'ECL provision ' || v_ref, v_ref, p_created_by
    )
    returning * into v_entry;

    if v_adjustment > 0 then
      -- Top-up: Dr 5640, Cr 1110
      insert into journal_lines (
        journal_entry_id, line_number, account_id, debit, credit, description
      ) values
        (v_entry.id, 1, v_expense_id, v_adjustment, 0, 'Bad Debt Expense (ECL)'),
        (v_entry.id, 2, v_allowance_id, 0, v_adjustment, 'Allowance for Expected Credit Losses');
    else
      -- Release: Dr 1110, Cr 5640
      insert into journal_lines (
        journal_entry_id, line_number, account_id, debit, credit, description
      ) values
        (v_entry.id, 1, v_allowance_id, abs(v_adjustment), 0, 'Allowance for Expected Credit Losses'),
        (v_entry.id, 2, v_expense_id, 0, abs(v_adjustment), 'Bad Debt Expense (ECL)');
    end if;

    update journal_entries
       set status = 'posted'
     where id = v_entry.id
       and status = 'draft'
    returning * into v_entry;

    if not found then
      raise exception 'Failed to post ECL provision entry %', v_entry_number;
    end if;

    v_journal_entry_id := v_entry.id;

    select coalesce(jsonb_agg(to_jsonb(jl) order by jl.line_number), '[]'::jsonb)
      into v_lines
      from journal_lines jl
     where jl.journal_entry_id = v_entry.id;
  end if;

  -- Step 5: record run; reviewed_by is null at post time (does not gate).
  insert into ecl_provision_runs (
    company_id,
    period_end_date,
    required_allowance,
    prior_allowance,
    adjustment_amount,
    journal_entry_id,
    created_by
  ) values (
    p_company_id,
    p_period_end_date,
    v_required,
    v_prior,
    v_adjustment,
    v_journal_entry_id,
    p_created_by
  )
  returning * into v_run;

  return jsonb_build_object(
    'run', to_jsonb(v_run),
    'entry', case when v_journal_entry_id is null then null else to_jsonb(v_entry) end,
    'lines', v_lines,
    'journal_entry_id', v_journal_entry_id
  );
end;
$$;

revoke all on function run_ecl_provision(uuid, date, uuid) from public;
revoke all on function run_ecl_provision(uuid, date, uuid) from authenticated;
revoke all on function run_ecl_provision(uuid, date, uuid) from anon;
grant execute on function run_ecl_provision(uuid, date, uuid) to service_role;

-- [feature-spec-1_1_D.md §4.5b]
-- Flag write_offs for VAT relief once 6 months past supply date + debtor notified.
-- Sets the flag only — Module F owns VAT-201 filing. Same schedule pattern as
-- mark_overdue_invoices (callable RPC; D-P11 wires cron).
create or replace function mark_vat_relief_eligible(
  p_company_id uuid,
  p_as_of_date date default current_date
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
  v_as_of date;
begin
  if p_company_id is null then
    raise exception 'COMPANY_ID_REQUIRED';
  end if;

  v_as_of := coalesce(p_as_of_date, current_date);

  perform pg_advisory_xact_lock(hashtext('vrl:' || p_company_id::text));

  update write_offs wo
     set vat_relief_eligible = true,
         vat_relief_flagged_at = now()
    from invoices i
   where wo.invoice_id = i.id
     and wo.company_id = p_company_id
     and wo.vat_relief_eligible = false
     and wo.debtor_notified_at is not null
     and i.invoice_date <= (v_as_of - interval '6 months')::date;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function mark_vat_relief_eligible(uuid, date) from public;
revoke all on function mark_vat_relief_eligible(uuid, date) from authenticated;
revoke all on function mark_vat_relief_eligible(uuid, date) from anon;
grant execute on function mark_vat_relief_eligible(uuid, date) to service_role;
