-- apply_module_d_ar_reports.sql
-- [feature-spec-1_1_D.md section 5 / D-P12]
-- Customer ledger, aged receivables, credit-limit check, payment history.
-- Pattern: SECURITY INVOKER + service_role EXECUTE (H1 section 5.1).
-- Idempotent (CREATE OR REPLACE).

-- ---------------------------------------------------------------------------
-- section 5.1 get_customer_ledger
-- AR-affecting rows feed running_balance; advance_receipt is informational only.
-- Subledger rows require non-null journal_entry_id (or paired advance_application JE).
-- ---------------------------------------------------------------------------
create or replace function get_customer_ledger(
  p_company_id uuid,
  p_customer_id uuid,
  p_date_from date default null,
  p_date_to date default null
)
returns table (
  entry_date date,
  source_type text,
  source_id uuid,
  document_number text,
  description text,
  debit numeric(18,2),
  credit numeric(18,2),
  affects_ar boolean,
  running_balance numeric(18,2),
  journal_entry_id uuid
)
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
begin
  if p_company_id is null then
    raise exception 'COMPANY_ID_REQUIRED';
  end if;
  if p_customer_id is null then
    raise exception 'CUSTOMER_ID_REQUIRED';
  end if;
  if p_date_from is not null and p_date_to is not null and p_date_to < p_date_from then
    raise exception 'INVALID_DATE_RANGE';
  end if;
  if not exists (
    select 1 from customers c
     where c.id = p_customer_id
       and c.company_id = p_company_id
  ) then
    raise exception 'CUSTOMER_COMPANY_MISMATCH';
  end if;

  return query
  with raw as (
    -- Posted invoices (Dr 1100)
    select
      i.invoice_date as entry_date,
      'invoice'::text as source_type,
      i.id as source_id,
      i.invoice_number as document_number,
      ('Invoice ' || coalesce(i.invoice_number, i.id::text))::text as description,
      i.grand_total as debit,
      0::numeric(18,2) as credit,
      true as affects_ar,
      i.journal_entry_id
    from invoices i
    join journal_entries je on je.id = i.journal_entry_id
    where i.company_id = p_company_id
      and i.customer_id = p_customer_id
      and i.journal_entry_id is not null
      and i.status <> 'void'
      and is_ledger_truth_status(je.status)

    union all

    -- Posted credit notes (Cr 1100)
    select
      cn.credit_note_date,
      'credit_note',
      cn.id,
      cn.credit_note_number,
      ('Credit note ' || coalesce(cn.credit_note_number, cn.id::text)),
      0::numeric(18,2),
      cn.grand_total,
      true,
      cn.journal_entry_id
    from credit_notes cn
    join journal_entries je on je.id = cn.journal_entry_id
    where cn.company_id = p_company_id
      and cn.customer_id = p_customer_id
      and cn.journal_entry_id is not null
      and cn.status <> 'void'
      and is_ledger_truth_status(je.status)

    union all

    -- Invoice-receipt payment applications (Cr 1100) — parent payment posted
    select
      pa.applied_at::date,
      'payment_application',
      pa.id,
      p.reference_number,
      ('Payment application ' || pa.id::text),
      0::numeric(18,2),
      pa.applied_amount,
      true,
      p.journal_entry_id
    from payment_applications pa
    join payments p on p.id = pa.payment_id
    join journal_entries je on je.id = p.journal_entry_id
    where p.company_id = p_company_id
      and p.customer_id = p_customer_id
      and p.journal_entry_id is not null
      and je.entry_type = 'customer_payment'
      and is_ledger_truth_status(je.status)

    union all

    -- Advance applications (Cr 1100) — paired advance_application JE via paa: ref
    select
      pa.applied_at::date,
      'payment_application',
      pa.id,
      p.reference_number,
      ('Advance application ' || pa.id::text),
      0::numeric(18,2),
      pa.applied_amount,
      true,
      je.id
    from payment_applications pa
    join payments p on p.id = pa.payment_id
    join journal_entries je
      on je.company_id = p.company_id
     and je.entry_type = 'advance_application'
     and je.reference_number = 'paa:' || pa.id::text
    where p.company_id = p_company_id
      and p.customer_id = p_customer_id
      and is_ledger_truth_status(je.status)

    union all

    -- Advance receipts (Cr 2060) — shown separately; do not feed AR running balance
    select
      p.payment_date,
      'advance_receipt',
      p.id,
      p.reference_number,
      ('Advance receipt ' || coalesce(p.reference_number, p.id::text)),
      0::numeric(18,2),
      p.amount,
      false,
      p.journal_entry_id
    from payments p
    join journal_entries je on je.id = p.journal_entry_id
    where p.company_id = p_company_id
      and p.customer_id = p_customer_id
      and p.journal_entry_id is not null
      and je.entry_type = 'advance_receipt'
      and is_ledger_truth_status(je.status)

    union all

    -- Write-offs (Cr 1100)
    select
      wo.created_at::date,
      'write_off',
      wo.id,
      null::text,
      ('Write-off ' || left(wo.reason, 80)),
      0::numeric(18,2),
      wo.amount,
      true,
      wo.journal_entry_id
    from write_offs wo
    join journal_entries je on je.id = wo.journal_entry_id
    where wo.company_id = p_company_id
      and wo.customer_id = p_customer_id
      and wo.journal_entry_id is not null
      and is_ledger_truth_status(je.status)
  ),
  filtered as (
    select *
      from raw r
     where (p_date_from is null or r.entry_date >= p_date_from)
       and (p_date_to is null or r.entry_date <= p_date_to)
  ),
  ordered as (
    select
      f.*,
      row_number() over (
        order by f.entry_date, f.source_type, f.source_id
      ) as sort_key,
      sum(case when f.affects_ar then f.debit - f.credit else 0 end) over (
        order by f.entry_date, f.source_type, f.source_id
        rows between unbounded preceding and current row
      )::numeric(18,2) as bal
    from filtered f
  )
  select
    o.entry_date,
    o.source_type,
    o.source_id,
    o.document_number,
    o.description,
    o.debit,
    o.credit,
    o.affects_ar,
    case when o.affects_ar then o.bal else null end,
    o.journal_entry_id
  from ordered o
  order by o.sort_key;
end;
$$;

revoke all on function get_customer_ledger(uuid, uuid, date, date) from public;
revoke all on function get_customer_ledger(uuid, uuid, date, date) from authenticated;
revoke all on function get_customer_ledger(uuid, uuid, date, date) from anon;
grant execute on function get_customer_ledger(uuid, uuid, date, date) to service_role;

-- ---------------------------------------------------------------------------
-- section 5.2 get_aged_receivables — D-5 buckets + totals row
-- ---------------------------------------------------------------------------
create or replace function get_aged_receivables(
  p_company_id uuid,
  p_as_of_date date
)
returns table (
  customer_id uuid,
  customer_name text,
  is_totals boolean,
  bucket_current numeric(18,2),
  bucket_0_30 numeric(18,2),
  bucket_31_60 numeric(18,2),
  bucket_61_90 numeric(18,2),
  bucket_90_plus numeric(18,2),
  total numeric(18,2)
)
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
declare
  v_as_of date;
begin
  if p_company_id is null then
    raise exception 'COMPANY_ID_REQUIRED';
  end if;
  if p_as_of_date is null then
    raise exception 'AS_OF_DATE_REQUIRED';
  end if;
  v_as_of := p_as_of_date;

  return query
  with open_inv as (
    select
      i.customer_id,
      c.customer_name,
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
      and i.journal_entry_id is not null
  ),
  per_customer as (
    select
      oi.customer_id,
      oi.customer_name,
      false as is_totals,
      coalesce(sum(oi.outstanding) filter (where oi.bucket = 'current'), 0)::numeric(18,2)
        as bucket_current,
      coalesce(sum(oi.outstanding) filter (where oi.bucket = '0_30'), 0)::numeric(18,2)
        as bucket_0_30,
      coalesce(sum(oi.outstanding) filter (where oi.bucket = '31_60'), 0)::numeric(18,2)
        as bucket_31_60,
      coalesce(sum(oi.outstanding) filter (where oi.bucket = '61_90'), 0)::numeric(18,2)
        as bucket_61_90,
      coalesce(sum(oi.outstanding) filter (where oi.bucket = '90_plus'), 0)::numeric(18,2)
        as bucket_90_plus,
      coalesce(sum(oi.outstanding), 0)::numeric(18,2) as total
    from open_inv oi
    group by oi.customer_id, oi.customer_name
  ),
  totals as (
    select
      null::uuid,
      'TOTALS'::text,
      true,
      coalesce(sum(pc.bucket_current), 0)::numeric(18,2),
      coalesce(sum(pc.bucket_0_30), 0)::numeric(18,2),
      coalesce(sum(pc.bucket_31_60), 0)::numeric(18,2),
      coalesce(sum(pc.bucket_61_90), 0)::numeric(18,2),
      coalesce(sum(pc.bucket_90_plus), 0)::numeric(18,2),
      coalesce(sum(pc.total), 0)::numeric(18,2)
    from per_customer pc
  )
  select * from per_customer
  union all
  select * from totals
  order by is_totals, customer_name nulls last;
end;
$$;

revoke all on function get_aged_receivables(uuid, date) from public;
revoke all on function get_aged_receivables(uuid, date) from authenticated;
revoke all on function get_aged_receivables(uuid, date) from anon;
grant execute on function get_aged_receivables(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- section 5.3 / D-4 check_customer_credit_limit — alert data only (non-blocking)
-- outstanding = open invoice balances − unapplied posted advance credit
-- ---------------------------------------------------------------------------
create or replace function check_customer_credit_limit(
  p_company_id uuid,
  p_customer_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
declare
  v_limit numeric(18,2);
  v_outstanding numeric(18,2);
  v_advances numeric(18,2);
  v_net numeric(18,2);
  v_exceeds boolean;
begin
  if p_company_id is null then
    raise exception 'COMPANY_ID_REQUIRED';
  end if;
  if p_customer_id is null then
    raise exception 'CUSTOMER_ID_REQUIRED';
  end if;

  select c.credit_limit into v_limit
    from customers c
   where c.id = p_customer_id
     and c.company_id = p_company_id;
  if not found then
    raise exception 'CUSTOMER_COMPANY_MISMATCH';
  end if;

  select coalesce(sum(i.grand_total - i.amount_paid), 0)
    into v_outstanding
    from invoices i
   where i.company_id = p_company_id
     and i.customer_id = p_customer_id
     and i.status in ('issued', 'sent', 'viewed', 'overdue', 'partially_paid')
     and i.amount_paid < i.grand_total
     and i.journal_entry_id is not null;

  -- Available unapplied advance credit: posted advance_receipt payments only (section 5)
  select coalesce(sum(p.unapplied_amount), 0)
    into v_advances
    from payments p
    join journal_entries je on je.id = p.journal_entry_id
   where p.company_id = p_company_id
     and p.customer_id = p_customer_id
     and p.journal_entry_id is not null
     and p.unapplied_amount > 0
     and je.entry_type = 'advance_receipt'
     and is_ledger_truth_status(je.status);

  v_net := (v_outstanding - v_advances)::numeric(18,2);
  v_exceeds := v_limit is not null and v_net > v_limit;

  return jsonb_build_object(
    'customer_id', p_customer_id,
    'credit_limit', v_limit,
    'open_invoice_outstanding', v_outstanding,
    'unapplied_advance_credit', v_advances,
    'outstanding_balance', v_net,
    'exceeds_credit_limit', v_exceeds,
    'alert', case
      when v_limit is null then null
      when v_exceeds then format(
        'Customer outstanding balance %s exceeds credit limit %s',
        v_net::text,
        v_limit::text
      )
      else null
    end
  );
end;
$$;

revoke all on function check_customer_credit_limit(uuid, uuid) from public;
revoke all on function check_customer_credit_limit(uuid, uuid) from authenticated;
revoke all on function check_customer_credit_limit(uuid, uuid) from anon;
grant execute on function check_customer_credit_limit(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- section 5.5 get_customer_payment_history — paid invoices only (paid_at set)
-- ---------------------------------------------------------------------------
create or replace function get_customer_payment_history(
  p_company_id uuid,
  p_customer_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
declare
  v_invoices jsonb;
  v_avg_actual numeric(18,2);
  v_avg_terms numeric(18,2);
  v_count int;
begin
  if p_company_id is null then
    raise exception 'COMPANY_ID_REQUIRED';
  end if;
  if p_customer_id is null then
    raise exception 'CUSTOMER_ID_REQUIRED';
  end if;
  if not exists (
    select 1 from customers c
     where c.id = p_customer_id
       and c.company_id = p_company_id
  ) then
    raise exception 'CUSTOMER_COMPANY_MISMATCH';
  end if;

  with paid as (
    select
      i.id as invoice_id,
      i.invoice_number,
      i.invoice_date,
      i.paid_at,
      i.payment_terms::text as payment_terms,
      case i.payment_terms
        when 'net_7' then 7
        when 'net_15' then 15
        when 'net_30' then 30
        when 'net_60' then 60
        when 'custom' then i.custom_days
        when 'cod' then 0
      end as terms_days,
      (i.paid_at::date - i.invoice_date) as actual_days_to_pay
    from invoices i
    where i.company_id = p_company_id
      and i.customer_id = p_customer_id
      and i.paid_at is not null
      and i.journal_entry_id is not null
      and i.status = 'paid'
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'invoice_id', p.invoice_id,
          'invoice_number', p.invoice_number,
          'invoice_date', p.invoice_date,
          'paid_at', p.paid_at,
          'payment_terms', p.payment_terms,
          'terms_days', p.terms_days,
          'actual_days_to_pay', p.actual_days_to_pay,
          'days_vs_terms', p.actual_days_to_pay - p.terms_days
        )
        order by p.paid_at, p.invoice_date, p.invoice_id
      ),
      '[]'::jsonb
    ),
    round(avg(p.actual_days_to_pay)::numeric, 2),
    round(avg(p.terms_days)::numeric, 2),
    count(*)::int
  into v_invoices, v_avg_actual, v_avg_terms, v_count
  from paid p;

  return jsonb_build_object(
    'customer_id', p_customer_id,
    'invoice_count', coalesce(v_count, 0),
    'average_actual_days_to_pay', v_avg_actual,
    'average_terms_days', v_avg_terms,
    'invoices', coalesce(v_invoices, '[]'::jsonb)
  );
end;
$$;

revoke all on function get_customer_payment_history(uuid, uuid) from public;
revoke all on function get_customer_payment_history(uuid, uuid) from authenticated;
revoke all on function get_customer_payment_history(uuid, uuid) from anon;
grant execute on function get_customer_payment_history(uuid, uuid) to service_role;
