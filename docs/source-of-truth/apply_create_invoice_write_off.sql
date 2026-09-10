-- [feature-spec-1_1_D.md §4.4 / D-8 / D-9]
-- create_invoice_write_off — Dr 1110 (+ Dr 5640 shortfall), Cr 1100; draft JE for Nest D-11 post.

create or replace function create_invoice_write_off(
  p_invoice_id uuid,
  p_created_by uuid,
  p_reason text,
  p_debtor_notified_at date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice            invoices%rowtype;
  v_period             accounting_periods%rowtype;
  v_entry_number       bigint;
  v_entry              journal_entries%rowtype;
  v_write_off          write_offs%rowtype;
  v_lines              jsonb;
  v_ar_id              uuid;
  v_allowance_id       uuid;
  v_expense_id         uuid;
  v_allowance_nb       normal_balance_type;
  v_write_off_amount   numeric(18,2);
  v_allowance_balance  numeric(18,2);
  v_from_allowance     numeric(18,2);
  v_shortfall          numeric(18,2);
  v_line_number        int := 0;
  v_entry_date         date := current_date;
  v_ref                text;
begin
  if p_created_by is null then
    raise exception 'CREATED_BY_REQUIRED';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'WRITE_OFF_REASON_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtext('wof:' || p_invoice_id::text));

  select * into v_invoice from invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'INVOICE_NOT_FOUND';
  end if;

  -- [§4.4] Available only for issued / overdue / partially_paid.
  if v_invoice.status not in ('issued', 'overdue', 'partially_paid') then
    raise exception 'INVOICE_NOT_OPEN_FOR_WRITE_OFF';
  end if;

  if exists (select 1 from write_offs where invoice_id = p_invoice_id) then
    raise exception 'INVOICE_ALREADY_WRITTEN_OFF';
  end if;

  v_write_off_amount := round((v_invoice.grand_total - v_invoice.amount_paid)::numeric, 2);
  if v_write_off_amount <= 0 then
    raise exception 'WRITE_OFF_NOTHING_DUE';
  end if;

  select id into v_ar_id
    from accounts
   where company_id = v_invoice.company_id
     and account_number = '1100'
     and is_active = true;
  if v_ar_id is null then
    raise exception 'WRITE_OFF_POSTING_ACCOUNT_NOT_FOUND';
  end if;

  select id, normal_balance into v_allowance_id, v_allowance_nb
    from accounts
   where company_id = v_invoice.company_id
     and account_number = '1110'
     and is_active = true;
  if v_allowance_id is null then
    raise exception 'WRITE_OFF_POSTING_ACCOUNT_NOT_FOUND';
  end if;

  select id into v_expense_id
    from accounts
   where company_id = v_invoice.company_id
     and account_number = '5640'
     and is_active = true;
  if v_expense_id is null then
    raise exception 'WRITE_OFF_POSTING_ACCOUNT_NOT_FOUND';
  end if;

  -- Current 1110 credit balance (allowance available to draw down).
  select coalesce(
           account_signed_balance(
             v_allowance_nb,
             sum(jl.debit),
             sum(jl.credit)
           ),
           0
         )
    into v_allowance_balance
    from journal_lines jl
    join journal_entries je on je.id = jl.journal_entry_id
   where jl.account_id = v_allowance_id
     and is_ledger_truth_status(je.status);

  v_allowance_balance := greatest(coalesce(v_allowance_balance, 0), 0);
  v_from_allowance := least(v_write_off_amount, v_allowance_balance);
  v_shortfall := round((v_write_off_amount - v_from_allowance)::numeric, 2);

  select * into v_period
    from accounting_periods
   where company_id = v_invoice.company_id
     and status = 'open'
     and period_start <= v_entry_date
     and period_end > v_entry_date
   order by period_start
   limit 1;

  if not found then
    raise exception 'NO_OPEN_PERIOD_FOR_WRITE_OFF_DATE';
  end if;

  v_ref := 'wof:' || p_invoice_id::text;
  v_entry_number := allocate_next_entry_number(v_invoice.company_id);

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
    v_invoice.company_id,
    v_entry_number,
    v_period.id,
    v_entry_date,
    'write_off',
    'draft',
    'Bad debt write-off ' || v_ref,
    v_ref,
    p_created_by
  )
  returning * into v_entry;

  -- [D-8 / §4.4] Primary: Dr 1110 Allowance, Cr 1100 AR — no P&L when provision covers it.
  if v_from_allowance > 0 then
    v_line_number := v_line_number + 1;
    insert into journal_lines (
      journal_entry_id, line_number, account_id, debit, credit, description
    ) values (
      v_entry.id, v_line_number, v_allowance_id, v_from_allowance, 0,
      'Allowance for Expected Credit Losses'
    );
  end if;

  -- [§4.4 corner case] Undersized 1110 provision: shortfall posts Dr 5640 Bad Debt
  -- Expense directly (not a silent rounding fix — explicit when allowance is short).
  if v_shortfall > 0 then
    v_line_number := v_line_number + 1;
    insert into journal_lines (
      journal_entry_id, line_number, account_id, debit, credit, description
    ) values (
      v_entry.id, v_line_number, v_expense_id, v_shortfall, 0,
      'Bad Debt Expense (ECL) — allowance shortfall'
    );
  end if;

  v_line_number := v_line_number + 1;
  insert into journal_lines (
    journal_entry_id, line_number, account_id, debit, credit, description
  ) values (
    v_entry.id, v_line_number, v_ar_id, 0, v_write_off_amount,
    'Accounts Receivable - Trade'
  );

  insert into write_offs (
    company_id,
    customer_id,
    invoice_id,
    amount,
    reason,
    journal_entry_id,
    debtor_notified_at,
    created_by
  ) values (
    v_invoice.company_id,
    v_invoice.customer_id,
    p_invoice_id,
    v_write_off_amount,
    btrim(p_reason),
    v_entry.id,
    p_debtor_notified_at,
    p_created_by
  )
  returning * into v_write_off;

  update invoices
     set status = 'written_off',
         updated_at = now()
   where id = p_invoice_id;

  select coalesce(jsonb_agg(to_jsonb(jl) order by jl.line_number), '[]'::jsonb)
    into v_lines
    from journal_lines jl
   where jl.journal_entry_id = v_entry.id;

  return jsonb_build_object(
    'write_off', to_jsonb(v_write_off),
    'entry', to_jsonb(v_entry),
    'lines', v_lines,
    'journal_entry_id', v_entry.id
  );
end;
$$;

revoke all on function create_invoice_write_off(uuid, uuid, text, date) from public;
revoke all on function create_invoice_write_off(uuid, uuid, text, date) from authenticated;
revoke all on function create_invoice_write_off(uuid, uuid, text, date) from anon;
grant execute on function create_invoice_write_off(uuid, uuid, text, date) to service_role;
