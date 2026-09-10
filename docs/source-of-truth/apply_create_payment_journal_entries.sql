-- apply_create_payment_journal_entries.sql
-- Apply in Supabase SQL editor on existing projects, then keep in sync with schema.sql.
--
-- [feature-spec-1_1_D.md 4.2, 4.3 / D-1, D-6, D-7, D-12]
-- Idempotent via CREATE OR REPLACE.

-- ============================================================================
-- 7g. Module 1.1.D — payment / advance ledger posting
--     (feature-spec-1_1_D.md §4.2, §4.3 / D-1, D-6, D-7, D-12)
--
-- [D-1] One `payments` table serves both invoice receipts and advances. The
-- credit account at receipt time depends on whether payment_applications
-- rows exist when we post — not on which table the row lives in:
--   applications present → Cr 1100 AR, entry_type customer_payment (§4.2)
--   no applications      → Cr 2060 advances, entry_type advance_receipt (§4.3)
-- Later application of an advance posts a second, cash-free reclass
-- (Dr 2060, Cr 1100, entry_type advance_application) — §4.3.
-- ============================================================================

-- [feature-spec-1_1_D.md §4.2 / D-12] Debit account: bank_account_id override,
-- else payment_method routing (cash 1010; card/pos 1070; bank_transfer/cheque/
-- other → company_settings.default_bank_account_id, falling back to 1020).
create or replace function resolve_payment_debit_account_id(
  p_company_id uuid,
  p_bank_account_id uuid,
  p_payment_method payment_method_type
)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid;
  v_default_bank uuid;
  v_number text;
begin
  if p_company_id is null then
    raise exception 'COMPANY_ID_REQUIRED';
  end if;

  if p_bank_account_id is not null then
    select id into v_account_id
      from accounts
     where id = p_bank_account_id
       and company_id = p_company_id
       and is_active = true;
    if v_account_id is null then
      raise exception 'PAYMENT_BANK_ACCOUNT_INVALID';
    end if;
    return v_account_id;
  end if;

  if p_payment_method is null then
    raise exception 'PAYMENT_METHOD_REQUIRED';
  end if;

  v_number := case p_payment_method
    when 'cash' then '1010'
    when 'card' then '1070'
    when 'pos' then '1070'
    else null
  end;

  if v_number is not null then
    select id into v_account_id
      from accounts
     where company_id = p_company_id
       and account_number = v_number
       and is_active = true;
    if v_account_id is null then
      raise exception 'PAYMENT_DEBIT_ACCOUNT_NOT_FOUND';
    end if;
    return v_account_id;
  end if;

  -- bank_transfer, cheque, other → default bank (D-6 / D-12)
  select default_bank_account_id into v_default_bank
    from company_settings
   where company_id = p_company_id;

  if v_default_bank is not null then
    select id into v_account_id
      from accounts
     where id = v_default_bank
       and company_id = p_company_id
       and is_active = true;
    if v_account_id is not null then
      return v_account_id;
    end if;
  end if;

  select id into v_account_id
    from accounts
   where company_id = p_company_id
     and account_number = '1020'
     and is_active = true;
  if v_account_id is null then
    raise exception 'PAYMENT_DEBIT_ACCOUNT_NOT_FOUND';
  end if;
  return v_account_id;
end;
$$;

-- [feature-spec-1_1_D.md §4.2 / §4.3 / D-1] Post the payment *receipt* journal
-- once (not per application). Credit side switches on applications-at-post-time.
create or replace function create_payment_journal_entry(
  p_payment_id uuid,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment          payments%rowtype;
  v_period           accounting_periods%rowtype;
  v_entry_number     bigint;
  v_entry            journal_entries%rowtype;
  v_lines            jsonb;
  v_debit_id         uuid;
  v_credit_id        uuid;
  v_credit_number    text;
  v_entry_type       journal_entry_type;
  v_has_applications boolean;
  v_ref              text;
  v_narration        text;
begin
  if p_created_by is null then
    raise exception 'CREATED_BY_REQUIRED';
  end if;

  select * into v_payment from payments where id = p_payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  if v_payment.journal_entry_id is not null then
    raise exception 'PAYMENT_JOURNAL_ALREADY_POSTED';
  end if;

  -- [D-1] Same payments row: credit account depends on applications at post time.
  select exists (
    select 1 from payment_applications where payment_id = p_payment_id
  ) into v_has_applications;

  if v_has_applications then
    -- §4.2 invoice receipt: Dr routed bank/cash, Cr 1100 AR
    v_entry_type := 'customer_payment';
    v_credit_number := '1100';
    v_narration := 'Customer payment';
  else
    -- §4.3 advance receipt: Dr bank, Cr 2060 Customer Advances (D-7)
    v_entry_type := 'advance_receipt';
    v_credit_number := '2060';
    v_narration := 'Customer advance receipt';
  end if;

  v_debit_id := resolve_payment_debit_account_id(
    v_payment.company_id,
    v_payment.bank_account_id,
    v_payment.payment_method
  );

  select id into v_credit_id
    from accounts
   where company_id = v_payment.company_id
     and account_number = v_credit_number
     and is_active = true;
  if v_credit_id is null then
    raise exception 'PAYMENT_POSTING_ACCOUNT_NOT_FOUND';
  end if;

  select * into v_period
    from accounting_periods
   where company_id = v_payment.company_id
     and status = 'open'
     and period_start <= v_payment.payment_date
     and period_end > v_payment.payment_date
   order by period_start
   limit 1;

  if not found then
    raise exception 'NO_OPEN_PERIOD_FOR_PAYMENT_DATE';
  end if;

  v_ref := coalesce(
    nullif(btrim(v_payment.reference_number), ''),
    'pay:' || v_payment.id::text
  );

  v_entry_number := allocate_next_entry_number(v_payment.company_id);

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
    v_payment.company_id,
    v_entry_number,
    v_period.id,
    v_payment.payment_date,
    v_entry_type,
    'draft',
    v_narration || ' ' || v_ref,
    v_ref,
    p_created_by
  )
  returning * into v_entry;

  insert into journal_lines (
    journal_entry_id, line_number, account_id, debit, credit, description
  ) values (
    v_entry.id, 1, v_debit_id, v_payment.amount, 0, 'Payment receipt debit'
  );

  insert into journal_lines (
    journal_entry_id, line_number, account_id, debit, credit, description
  ) values (
    v_entry.id, 2, v_credit_id, 0, v_payment.amount,
    case
      when v_entry_type = 'customer_payment' then 'Accounts Receivable - Trade'
      else 'Customer Advances / Deposits Received'
    end
  );

  update journal_entries
     set status = 'posted'
   where id = v_entry.id
     and status = 'draft'
  returning * into v_entry;

  if not found then
    raise exception 'Failed to post payment entry %', v_entry_number;
  end if;

  update payments
     set journal_entry_id = v_entry.id,
         updated_at = now()
   where id = p_payment_id;

  select coalesce(jsonb_agg(to_jsonb(jl) order by jl.line_number), '[]'::jsonb)
    into v_lines
    from journal_lines jl
   where jl.journal_entry_id = v_entry.id;

  return jsonb_build_object(
    'entry', to_jsonb(v_entry),
    'lines', v_lines,
    'journal_entry_id', v_entry.id,
    'entry_type', v_entry_type::text
  );
end;
$$;

-- [feature-spec-1_1_D.md §4.3] Cash-free reclass when an advance is applied to
-- an invoice: Dr 2060, Cr 1100 for applied_amount. Does not touch the original
-- advance_receipt journal. Invoice amount_paid / status: trg_refresh_invoice_amount_paid_from_applications (§4.1).
create or replace function create_advance_application_journal_entry(
  p_payment_application_id uuid,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_app              payment_applications%rowtype;
  v_payment          payments%rowtype;
  v_receipt_type     journal_entry_type;
  v_period           accounting_periods%rowtype;
  v_entry_number     bigint;
  v_entry            journal_entries%rowtype;
  v_lines            jsonb;
  v_advances_id      uuid;
  v_ar_id            uuid;
  v_entry_date       date;
  v_ref              text;
begin
  if p_created_by is null then
    raise exception 'CREATED_BY_REQUIRED';
  end if;

  select * into v_app from payment_applications where id = p_payment_application_id;
  if not found then
    raise exception 'PAYMENT_APPLICATION_NOT_FOUND';
  end if;

  select * into v_payment from payments where id = v_app.payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  if v_payment.journal_entry_id is null then
    raise exception 'ADVANCE_RECEIPT_NOT_POSTED';
  end if;

  select entry_type into v_receipt_type
    from journal_entries
   where id = v_payment.journal_entry_id;
  if v_receipt_type is distinct from 'advance_receipt' then
    raise exception 'PAYMENT_NOT_ADVANCE_RECEIPT';
  end if;

  -- Idempotency: no journal_entry_id on payment_applications (§3.3) — use
  -- reference_number prefix to block double-post of the same application.
  v_ref := 'paa:' || v_app.id::text;
  if exists (
    select 1 from journal_entries
     where company_id = v_payment.company_id
       and entry_type = 'advance_application'
       and reference_number = v_ref
  ) then
    raise exception 'ADVANCE_APPLICATION_JOURNAL_ALREADY_POSTED';
  end if;

  select id into v_advances_id
    from accounts
   where company_id = v_payment.company_id
     and account_number = '2060'
     and is_active = true;
  if v_advances_id is null then
    raise exception 'PAYMENT_POSTING_ACCOUNT_NOT_FOUND';
  end if;

  select id into v_ar_id
    from accounts
   where company_id = v_payment.company_id
     and account_number = '1100'
     and is_active = true;
  if v_ar_id is null then
    raise exception 'PAYMENT_POSTING_ACCOUNT_NOT_FOUND';
  end if;

  v_entry_date := v_app.applied_at::date;

  select * into v_period
    from accounting_periods
   where company_id = v_payment.company_id
     and status = 'open'
     and period_start <= v_entry_date
     and period_end > v_entry_date
   order by period_start
   limit 1;

  if not found then
    raise exception 'NO_OPEN_PERIOD_FOR_APPLICATION_DATE';
  end if;

  v_entry_number := allocate_next_entry_number(v_payment.company_id);

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
    v_payment.company_id,
    v_entry_number,
    v_period.id,
    v_entry_date,
    'advance_application',
    'draft',
    'Advance application ' || v_ref,
    v_ref,
    p_created_by
  )
  returning * into v_entry;

  insert into journal_lines (
    journal_entry_id, line_number, account_id, debit, credit, description
  ) values (
    v_entry.id, 1, v_advances_id, v_app.applied_amount, 0,
    'Customer Advances / Deposits Received'
  );

  insert into journal_lines (
    journal_entry_id, line_number, account_id, debit, credit, description
  ) values (
    v_entry.id, 2, v_ar_id, 0, v_app.applied_amount,
    'Accounts Receivable - Trade'
  );

  update journal_entries
     set status = 'posted'
   where id = v_entry.id
     and status = 'draft'
  returning * into v_entry;

  if not found then
    raise exception 'Failed to post advance application entry %', v_entry_number;
  end if;

  select coalesce(jsonb_agg(to_jsonb(jl) order by jl.line_number), '[]'::jsonb)
    into v_lines
    from journal_lines jl
   where jl.journal_entry_id = v_entry.id;

  return jsonb_build_object(
    'entry', to_jsonb(v_entry),
    'lines', v_lines,
    'journal_entry_id', v_entry.id
  );
end;
$$;

revoke all on function resolve_payment_debit_account_id(uuid, uuid, payment_method_type) from public;
revoke all on function resolve_payment_debit_account_id(uuid, uuid, payment_method_type) from authenticated;
revoke all on function resolve_payment_debit_account_id(uuid, uuid, payment_method_type) from anon;
grant execute on function resolve_payment_debit_account_id(uuid, uuid, payment_method_type) to service_role;

revoke all on function create_payment_journal_entry(uuid, uuid) from public;
revoke all on function create_payment_journal_entry(uuid, uuid) from authenticated;
revoke all on function create_payment_journal_entry(uuid, uuid) from anon;
grant execute on function create_payment_journal_entry(uuid, uuid) to service_role;

revoke all on function create_advance_application_journal_entry(uuid, uuid) from public;
revoke all on function create_advance_application_journal_entry(uuid, uuid) from authenticated;
revoke all on function create_advance_application_journal_entry(uuid, uuid) from anon;
grant execute on function create_advance_application_journal_entry(uuid, uuid) to service_role;
