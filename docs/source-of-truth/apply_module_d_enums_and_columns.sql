-- apply_module_d_enums_and_columns.sql
-- Apply in Supabase SQL editor on existing projects, then keep in sync with schema.sql.
--
-- [feature-spec-1_1_D.md §3.1, §3.1a, §3.4b, §3.5, §3.6 / D-3, D-6, D-10, D-11, D-12, D-13]
-- Additive only — new enum, new enum values, new columns, one new check constraint,
-- one new FK. Does not alter existing columns, constraints, or RPCs.
--
-- Idempotent: safe to run twice. Enum ADD VALUE IF NOT EXISTS; columns IF NOT EXISTS;
-- constraint/FK guarded by pg_catalog lookups.
--
-- company_settings seeding note: there is no trigger that creates company_settings.
-- Rows are inserted by Nest (e2e-company.setup) / seed_finalized_coa before the COA
-- exists, so default_bank_account_id is backfilled to account 1020 below after the
-- column exists. write_off_approval_threshold / weekend_days use column defaults.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'payment_method_type'
  ) then
    create type public.payment_method_type as enum (
      'cash',
      'bank_transfer',
      'cheque',
      'card',
      'pos',
      'other'
    );
  end if;
end $$;

alter type journal_entry_type add value if not exists 'customer_payment';
alter type journal_entry_type add value if not exists 'advance_receipt';
alter type journal_entry_type add value if not exists 'advance_application';
alter type journal_entry_type add value if not exists 'write_off';
alter type journal_entry_type add value if not exists 'ecl_provision';

-- ---------------------------------------------------------------------------
-- customers (§3.1, §3.4b)
-- ---------------------------------------------------------------------------

alter table customers
  add column if not exists credit_limit numeric(18,2);

alter table customers
  add column if not exists ecl_override_rate numeric(6,4);

alter table customers
  add column if not exists ecl_override_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'customers_ecl_override_reason_required'
      and conrelid = 'public.customers'::regclass
  ) then
    alter table customers
      add constraint customers_ecl_override_reason_required check (
        ecl_override_rate is null
        or (ecl_override_reason is not null and btrim(ecl_override_reason) <> '')
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- invoices (§3.5 / D-3)
-- ---------------------------------------------------------------------------

alter table invoices
  add column if not exists paid_at timestamptz;

-- ---------------------------------------------------------------------------
-- company_settings (§3.1a / D-6, D-10, D-11, D-13)
-- ---------------------------------------------------------------------------

alter table company_settings
  add column if not exists default_bank_account_id uuid;

alter table company_settings
  add column if not exists write_off_approval_threshold numeric(18,2) not null default 5000;

alter table company_settings
  add column if not exists weekend_days smallint[] not null default '{6,7}';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'company_settings_default_bank_account_id_fkey'
      and conrelid = 'public.company_settings'::regclass
  ) then
    alter table company_settings
      add constraint company_settings_default_bank_account_id_fkey
      foreign key (default_bank_account_id) references accounts(id);
  end if;
end $$;

-- Backfill default bank → 1020 where still null (same post-COA step as seed).
update company_settings cs
   set default_bank_account_id = a.id
  from accounts a
 where a.company_id = cs.company_id
   and a.account_number = '1020'
   and cs.default_bank_account_id is null;
