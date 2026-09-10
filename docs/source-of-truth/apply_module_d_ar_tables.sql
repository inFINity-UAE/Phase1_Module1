-- apply_module_d_ar_tables.sql
-- Apply in Supabase SQL editor on existing projects, then keep in sync with schema.sql.
--
-- [feature-spec-1_1_D.md §3.2, §3.3, §3.4, §3.4a, §3.4c, §3.7]
-- Additive: payments, payment_applications, write_offs, ecl_loss_rate_policies,
-- ecl_provision_runs, unapplied_amount triggers, acquire_ecl_provision_lock.
-- Idempotent where IF NOT EXISTS / DROP POLICY IF EXISTS allow.
-- Seed rates separately via seed_ecl_loss_rate_policies.sql.

create table if not exists payments (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id),
  customer_id        uuid not null references customers(id),
  payment_date       date not null,
  amount             numeric(18,2) not null check (amount > 0),
  payment_method     payment_method_type,
  reference_number   text,
  bank_account_id    uuid references accounts(id),
  unapplied_amount   numeric(18,2) not null,
  journal_entry_id   uuid references journal_entries(id),
  created_by         uuid not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint payments_unapplied_within_amount check (
    unapplied_amount >= 0 and unapplied_amount <= amount
  )
);

create index if not exists idx_payments_company on payments(company_id);
create index if not exists idx_payments_customer on payments(customer_id);
create index if not exists idx_payments_date on payments(company_id, payment_date);
create index if not exists idx_payments_journal_entry on payments(journal_entry_id)
  where journal_entry_id is not null;

create or replace function set_payment_unapplied_on_insert()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.unapplied_amount := new.amount;
  return new;
end;
$$;

drop trigger if exists trg_set_payment_unapplied_on_insert on payments;
create trigger trg_set_payment_unapplied_on_insert
  before insert on payments
  for each row execute function set_payment_unapplied_on_insert();

create table if not exists payment_applications (
  id              uuid primary key default gen_random_uuid(),
  payment_id      uuid not null references payments(id) on delete cascade,
  invoice_id      uuid not null references invoices(id),
  applied_amount  numeric(18,2) not null check (applied_amount > 0),
  applied_at      timestamptz not null default now(),
  applied_by      uuid not null
);

create index if not exists idx_payment_applications_payment on payment_applications(payment_id);
create index if not exists idx_payment_applications_invoice on payment_applications(invoice_id);

create or replace function refresh_payment_unapplied_amount()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_payment_id uuid;
  v_amount numeric(18,2);
  v_applied numeric(18,2);
  v_unapplied numeric(18,2);
begin
  v_payment_id := coalesce(new.payment_id, old.payment_id);
  perform pg_advisory_xact_lock(hashtext('pay:' || v_payment_id::text));

  select amount into v_amount from payments where id = v_payment_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  select coalesce(sum(applied_amount), 0)
    into v_applied
    from payment_applications
   where payment_id = v_payment_id;

  v_unapplied := v_amount - v_applied;
  if v_unapplied < 0 then
    raise exception 'PAYMENT_APPLICATIONS_EXCEED_AMOUNT';
  end if;

  update payments
     set unapplied_amount = v_unapplied,
         updated_at = now()
   where id = v_payment_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_refresh_payment_unapplied_amount on payment_applications;
create trigger trg_refresh_payment_unapplied_amount
  after insert or update or delete on payment_applications
  for each row execute function refresh_payment_unapplied_amount();

create table if not exists write_offs (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references companies(id),
  customer_id            uuid not null references customers(id),
  invoice_id             uuid not null references invoices(id),
  amount                 numeric(18,2) not null check (amount > 0),
  reason                 text not null,
  journal_entry_id       uuid references journal_entries(id),
  debtor_notified_at     date,
  vat_relief_eligible    boolean not null default false,
  vat_relief_flagged_at  timestamptz,
  created_by             uuid not null,
  created_at             timestamptz not null default now()
);

create index if not exists idx_write_offs_company on write_offs(company_id);
create index if not exists idx_write_offs_customer on write_offs(customer_id);
create index if not exists idx_write_offs_invoice on write_offs(invoice_id);
create index if not exists idx_write_offs_vat_relief on write_offs(company_id, vat_relief_eligible)
  where vat_relief_eligible = false;

create table if not exists ecl_loss_rate_policies (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id),
  bucket          text not null,
  loss_rate       numeric(6,4) not null,
  effective_from  date not null,
  created_by      uuid not null,
  created_at      timestamptz not null default now(),
  unique (company_id, bucket, effective_from),
  constraint ecl_loss_rate_policies_bucket_check check (
    bucket in ('current', '0_30', '31_60', '61_90', '90_plus')
  ),
  constraint ecl_loss_rate_policies_rate_range check (
    loss_rate >= 0 and loss_rate <= 1
  )
);

create index if not exists idx_ecl_loss_rate_policies_company
  on ecl_loss_rate_policies(company_id, bucket, effective_from desc);

create table if not exists ecl_provision_runs (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id),
  period_end_date     date not null,
  required_allowance  numeric(18,2) not null,
  prior_allowance     numeric(18,2) not null,
  adjustment_amount   numeric(18,2) not null,
  journal_entry_id    uuid references journal_entries(id),
  reviewed_by         uuid,
  created_by          uuid not null,
  created_at          timestamptz not null default now(),
  unique (company_id, period_end_date)
);

create index if not exists idx_ecl_provision_runs_company on ecl_provision_runs(company_id);

create or replace function acquire_ecl_provision_lock(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_company_id is null then
    raise exception 'COMPANY_ID_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtext('ecl:' || p_company_id::text));
end;
$$;

alter table payments enable row level security;
alter table payment_applications enable row level security;
alter table write_offs enable row level security;
alter table ecl_loss_rate_policies enable row level security;
alter table ecl_provision_runs enable row level security;

drop policy if exists company_isolation_payments on payments;
create policy company_isolation_payments on payments
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);

drop policy if exists company_isolation_payment_applications on payment_applications;
create policy company_isolation_payment_applications on payment_applications
  using (
    payment_id in (
      select id from payments
      where company_id = (select current_setting('app.current_company_id', true))::uuid
    )
  );

drop policy if exists company_isolation_write_offs on write_offs;
create policy company_isolation_write_offs on write_offs
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);

drop policy if exists company_isolation_ecl_loss_rate_policies on ecl_loss_rate_policies;
create policy company_isolation_ecl_loss_rate_policies on ecl_loss_rate_policies
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);

drop policy if exists company_isolation_ecl_provision_runs on ecl_provision_runs;
create policy company_isolation_ecl_provision_runs on ecl_provision_runs
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);

revoke all on function set_payment_unapplied_on_insert() from public;
revoke all on function set_payment_unapplied_on_insert() from authenticated;
revoke all on function set_payment_unapplied_on_insert() from anon;
grant execute on function set_payment_unapplied_on_insert() to service_role;

revoke all on function refresh_payment_unapplied_amount() from public;
revoke all on function refresh_payment_unapplied_amount() from authenticated;
revoke all on function refresh_payment_unapplied_amount() from anon;
grant execute on function refresh_payment_unapplied_amount() to service_role;

revoke all on function acquire_ecl_provision_lock(uuid) from public;
revoke all on function acquire_ecl_provision_lock(uuid) from authenticated;
revoke all on function acquire_ecl_provision_lock(uuid) from anon;
grant execute on function acquire_ecl_provision_lock(uuid) to service_role;

grant select, insert, update, delete on public.payments to service_role;
grant select, insert, update, delete on public.payment_applications to service_role;
grant select, insert, update, delete on public.write_offs to service_role;
grant select, insert, update, delete on public.ecl_loss_rate_policies to service_role;
grant select, insert, update, delete on public.ecl_provision_runs to service_role;
