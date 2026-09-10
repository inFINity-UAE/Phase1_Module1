-- [feature-spec-1_1_D.md §4.1 / D-3 / §4.3]
-- Wire invoice amount_paid / partially_paid / paid / paid_at from payment_applications.
-- Live patch for DBs that already have Module D AR tables.

create or replace function prevent_invoice_computed_totals_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Totals: only the draft recalc trigger may write these.
  if current_setting('app.invoice_recalc_in_progress', true) is distinct from 'true' then
    if new.subtotal is distinct from old.subtotal
       or new.vat_total is distinct from old.vat_total
       or new.grand_total is distinct from old.grand_total then
      raise exception 'INVOICE_TOTALS_CLIENT_MUTATION_BLOCKED';
    end if;
  end if;

  -- [feature-spec-1_1_D.md §4.1 / D-3] amount_paid / paid_at only via
  -- payment_applications refresh trigger (never client-set).
  if current_setting('app.invoice_payment_apply_in_progress', true) is distinct from 'true' then
    if new.amount_paid is distinct from old.amount_paid
       or new.paid_at is distinct from old.paid_at then
      raise exception 'INVOICE_AMOUNT_PAID_CLIENT_MUTATION_BLOCKED';
    end if;
  end if;

  return new;
end;
$$;

create or replace function refresh_invoice_amount_paid_from_applications()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_invoice_ids uuid[] := array[]::uuid[];
  v_invoice_id uuid;
  v_invoice invoices%rowtype;
  v_payment payments%rowtype;
  v_paid numeric(18,2);
  v_new_status invoice_status;
  v_paid_at timestamptz;
begin
  if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id then
    v_invoice_ids := array[old.invoice_id, new.invoice_id];
  else
    v_invoice_ids := array[coalesce(new.invoice_id, old.invoice_id)];
  end if;

  foreach v_invoice_id in array v_invoice_ids
  loop
    -- Serialise concurrent applications against one invoice (belt-and-suspenders
    -- with the over-apply check below).
    perform pg_advisory_xact_lock(hashtext('invpay:' || v_invoice_id::text));

    select * into v_invoice from invoices where id = v_invoice_id for update;
    if not found then
      raise exception 'INVOICE_NOT_FOUND';
    end if;

    -- On insert/update targeting this invoice, reject closed/uninvoiced statuses.
    if tg_op in ('INSERT', 'UPDATE') and new.invoice_id = v_invoice_id then
      if v_invoice.status in ('draft', 'void', 'written_off') then
        raise exception 'INVOICE_NOT_OPEN_FOR_PAYMENT';
      end if;

      select * into v_payment
        from payments
       where id = new.payment_id;
      if not found then
        raise exception 'PAYMENT_NOT_FOUND';
      end if;
      if v_payment.company_id is distinct from v_invoice.company_id
         or v_payment.customer_id is distinct from v_invoice.customer_id then
        raise exception 'PAYMENT_INVOICE_CUSTOMER_MISMATCH';
      end if;
    end if;

    select coalesce(sum(applied_amount), 0)
      into v_paid
      from payment_applications
     where invoice_id = v_invoice_id;

    if v_paid > v_invoice.grand_total then
      raise exception 'INVOICE_PAYMENT_OVER_APPLIED';
    end if;

    if v_paid = 0 then
      if v_invoice.status in ('partially_paid', 'paid') then
        if v_invoice.due_date is not null and v_invoice.due_date < current_date then
          v_new_status := 'overdue';
        else
          v_new_status := 'issued';
        end if;
      else
        v_new_status := v_invoice.status;
      end if;
      v_paid_at := v_invoice.paid_at; -- D-3: never clear once set
    elsif v_paid < v_invoice.grand_total then
      v_new_status := 'partially_paid';
      v_paid_at := v_invoice.paid_at;
    else
      -- amount_paid = grand_total
      v_new_status := 'paid';
      v_paid_at := coalesce(v_invoice.paid_at, now()); -- D-3: stamp once
    end if;

    perform set_config('app.invoice_payment_apply_in_progress', 'true', true);

    update invoices
       set amount_paid = v_paid,
           status = v_new_status,
           paid_at = v_paid_at,
           updated_at = now()
     where id = v_invoice_id;

    perform set_config('app.invoice_payment_apply_in_progress', '', true);
  end loop;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_refresh_invoice_amount_paid_from_applications on payment_applications;
create trigger trg_refresh_invoice_amount_paid_from_applications
  after insert or update or delete on payment_applications
  for each row execute function refresh_invoice_amount_paid_from_applications();

revoke all on function refresh_invoice_amount_paid_from_applications() from public;
revoke all on function refresh_invoice_amount_paid_from_applications() from authenticated;
revoke all on function refresh_invoice_amount_paid_from_applications() from anon;
grant execute on function refresh_invoice_amount_paid_from_applications() to service_role;

-- Comment sync for create_advance_application_journal_entry (body unchanged).
comment on function create_advance_application_journal_entry(uuid, uuid) is
  'feature-spec-1_1_D.md §4.3: Dr 2060 Cr 1100 reclass; amount_paid moved by payment_applications trigger (§4.1), not advance_receipt.';
