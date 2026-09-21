-- inFINity — Module 1.1.A Ledger Schema (PostgreSQL / Supabase)
-- ============================================================================
-- Single source of truth for DB structure. Apply top-to-bottom on fresh projects.
-- Business rules: feature-spec.md §4; decision index §8.
-- Includes: RLS, triggers, advisory-lock RPCs (§9b), views (§9), grants (§12).
-- Do not maintain separate apply_*.sql patches — fold changes here.
-- ============================================================================

-- Extensions in schema `extensions` (not `public`) — Security Advisor lint 0014.
-- If btree_gist already exists elsewhere, drop + recreate (see DO block below).
create schema if not exists extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- btree_gist: required for period overlap exclusion; relocatable via drop/recreate.
do $$
begin
  if exists (
    select 1
      from pg_extension e
      join pg_namespace n on n.oid = e.extnamespace
     where e.extname = 'btree_gist'
       and n.nspname <> 'extensions'
  ) then
    drop extension btree_gist cascade;
  end if;
end $$;
create extension if not exists btree_gist with schema extensions;

-- ============================================================================
-- 0. ENUMS
-- ============================================================================

create type account_category as enum ('asset', 'liability', 'equity', 'income', 'expense');
create type normal_balance_type as enum ('debit', 'credit');

create type period_status as enum ('open', 'soft_closed', 'closed');

-- [feature-spec-1.1.C.md decision #13 / Batch 2 prerequisite] Module 1.1.C
-- ledger posting entry classification — additive only; no existing rows use these values.
-- [feature-spec-1_1_D.md §3.6] Module 1.1.D AR posting types — additive only.
-- [feature-spec-1_1_E.md E-15] Module 1.1.E AP posting types — additive only.
-- [feature-spec-1_1_F.md F-24] Module 1.1.F VAT posting types — additive only; RCM stays purchase_invoice.
create type journal_entry_type as enum (
  'manual',
  'recurring',
  'reversal',
  'opening_balance',
  'year_end_closing',
  'system',
  'sales_invoice',
  'credit_note',
  'customer_payment',
  'advance_receipt',
  'advance_application',
  'write_off',
  'ecl_provision',
  'purchase_invoice',
  'supplier_payment',
  'supplier_advance',
  'supplier_advance_application',
  'grni_accrual',
  'vat_apportionment',
  'vat_capital_goods_adjustment',
  'vat_return_settlement',
  'vat_payment',
  'vat_refund_claim',
  'vat_bad_debt_relief',
  'vat_penalty',
  'vat_period_correction',
  'ct_provision'
);

-- [feature-spec-1_1_F.md §3.1 / F-19 / F-25 / F-43]
create type vat_category as enum (
  'standard_rated', 'zero_rated', 'exempt', 'out_of_scope', 'designated_zone'
);
create type vat_input_treatment as enum (
  'recoverable', 'reverse_charge', 'blocked_entertainment',
  'blocked_other', 'mixed_use'
);
create type vat_return_status as enum (
  'draft', 'calculated', 'under_review', 'approved', 'filed', 'superseded'
);
create type vat_refund_claim_status as enum ('none', 'eligible', 'claimed');
create type vat_relief_claim_status as enum (
  'pending_eligible', 'claimed', 'reversed'
);
create type uae_emirate as enum (
  'abu_dhabi', 'dubai', 'sharjah', 'ajman',
  'umm_al_quwain', 'ras_al_khaimah', 'fujairah'
);
create type capital_asset_category as enum (
  'building_real_estate', 'other'
);
create type vat_correction_path as enum (
  'next_period', 'voluntary_disclosure'
);

-- [feature-spec-1_1_G.md §3.1]
create type ct_income_adjustment_type as enum (
  'qualifying_dividend', 'intragroup_transaction',
  'non_deductible_entertainment', 'non_deductible_other'
);
create type ct_provision_status as enum (
  'draft', 'posted', 'posted_nil', 'superseded'
);
create type related_party_relationship as enum (
  'shareholder', 'director', 'group_company', 'other_connected_person'
);

-- [feature-spec-1_1_D.md §3.2 / D-12] Payment method → debit-account routing.
create type payment_method_type as enum (
  'cash',
  'bank_transfer',
  'cheque',
  'card',
  'pos',
  'other'
);

create type journal_entry_status as enum (
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'posted',
  'reversed'
);

create type recurrence_frequency as enum ('daily', 'weekly', 'monthly', 'quarterly', 'annually');

-- delete_blocked: service-layer record of a rejected hard-delete attempt
-- (posted entry/line). Cannot be written inside the blocking trigger's
-- transaction — that ROLLBACK would erase it. See feature-spec.md #56.
create type audit_action as enum (
  'insert',
  'update',
  'reversal',
  'status_change',
  'delete_blocked'
);

-- ============================================================================
-- 1. COMPANIES (multi-tenant root)
-- ============================================================================

create table companies (
  id                    uuid primary key default gen_random_uuid(),
  legal_name            text not null,
  trn                   text,                      -- UAE Tax Registration Number
  base_currency         char(3) not null default 'AED',
  is_free_zone_entity   boolean not null default false,
  fiscal_year_start_month smallint not null default 1 check (fiscal_year_start_month between 1 and 12),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Company-level configurable settings (approval threshold, close policy, etc.)
-- Kept as a separate 1:1 table so rule changes don't churn the companies row.
-- [feature-spec-1_1_D.md §3.1a / D-6, D-10, D-11, D-13]
-- No trigger creates this row — Nest e2e setup and seed_finalized_coa insert it
-- before the COA exists, so default_bank_account_id is backfilled to account 1020
-- after accounts are present (seed UPDATE backfill to account 1020).
-- FK to accounts is added after the accounts table exists (declared below).
create table company_settings (
  company_id                    uuid primary key references companies(id) on delete cascade,
  journal_approval_threshold    numeric(18,2),        -- entries above this need Owner approval; null = disabled
  approval_threshold_currency   char(3) not null default 'AED',
  default_period_length         text not null default 'monthly', -- monthly | quarterly
  allow_period_reopen           boolean not null default true,
  default_bank_account_id       uuid,                 -- D-6; FK + 1020 seed after accounts
  write_off_approval_threshold  numeric(18,2) not null default 5000, -- D-11 AED 5,000
  weekend_days                  smallint[] not null default '{6,7}', -- D-10/D-13 ISO Sat/Sun
  -- [feature-spec-1_1_E.md E-26] split three-way match tolerance; no settings write API
  three_way_match_qty_tolerance_pct   numeric(5,2) not null default 0,
  three_way_match_price_tolerance_pct numeric(5,2) not null default 2,
  -- [feature-spec-1_1_F.md F-10 / F-29 / F-43] seed/SQL only — no PATCH API (D-13/E-26)
  fta_api_enabled               boolean not null default false,
  vat_return_frequency          text not null default 'quarterly'
    check (vat_return_frequency in ('monthly', 'quarterly')),
  default_emirate               uae_emirate,
  updated_at                    timestamptz not null default now()
);

-- ============================================================================
-- 2. ACCOUNTS (Chart of Accounts)
-- ============================================================================

create table accounts (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,

  account_number    char(4) not null,               -- 1000s Assets / 2000s Liab / 3000s Equity / 4000s Income / 5000s Expense
  account_name      text not null,
  category          account_category not null,
  sub_category      text,                            -- e.g. 'Current Asset', 'Fixed Asset', 'Free Zone Income'
  normal_balance    normal_balance_type not null,

  parent_account_id uuid references accounts(id),    -- self-referencing hierarchy
  depth             smallint not null default 1 check (depth between 1 and 4), -- max 4 levels deep

  is_system_account boolean not null default false,  -- e.g. Retained Earnings — protected from deletion/renumbering
  is_active         boolean not null default true,    -- "locking": deactivated, never deleted
  locked_at         timestamptz,
  locked_reason     text,

  description       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (company_id, account_number)
);

create index idx_accounts_company on accounts(company_id);
create index idx_accounts_parent on accounts(parent_account_id);
create index idx_accounts_category on accounts(company_id, category);

-- [feature-spec-1_1_D.md §3.1a / D-6] FK deferred until accounts exists
-- (company_settings is created before accounts in §1).
alter table company_settings
  add constraint company_settings_default_bank_account_id_fkey
  foreign key (default_bank_account_id) references accounts(id);

-- ============================================================================
-- 1b. PUBLIC HOLIDAYS (Module 1.1.D — feature-spec-1_1_D.md §3.1b / D-10, D-14)
-- UAE-wide rows: company_id IS NULL. Company-scoped rows override the same date.
-- ============================================================================

create table public_holidays (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid references companies(id),   -- null = UAE-wide
  holiday_date   date not null,
  description    text not null,
  status         text not null default 'PROVISIONAL',
  source         text,                             -- e.g. 'Cabinet Resolution 27/2024 Art.1'
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint public_holidays_status_check check (
    status in ('PROVISIONAL', 'CONFIRMED')
  )
);

-- Two partial unique indexes — a plain unique(company_id, holiday_date) treats
-- NULLs as distinct and would allow duplicate UAE-wide rows for the same date.
create unique index public_holidays_company_date_uq
  on public_holidays (company_id, holiday_date)
  where company_id is not null;

create unique index public_holidays_uae_date_uq
  on public_holidays (holiday_date)
  where company_id is null;

create index idx_public_holidays_company on public_holidays(company_id);
create index idx_public_holidays_date on public_holidays(holiday_date);

-- Enforce account_number's leading digit matches its category (1xxx=Asset, etc.)
create or replace function enforce_account_number_category()
returns trigger as $$
declare
  expected_prefix char(1);
begin
  expected_prefix := case new.category
    when 'asset'     then '1'
    when 'liability' then '2'
    when 'equity'    then '3'
    when 'income'    then '4'
    when 'expense'   then '5'
  end;
  if left(new.account_number, 1) <> expected_prefix then
    raise exception 'Account number % does not match category % (expected prefix %)',
      new.account_number, new.category, expected_prefix;
  end if;
  return new;
end;
$$ language plpgsql
   set search_path = public, pg_temp;

create trigger trg_enforce_account_number_category
  before insert or update on accounts
  for each row execute function enforce_account_number_category();

-- Enforce hierarchy depth <= 4, same-company parent, and auto-compute depth.
-- [feature-spec.md decision #45 / §7.16 finding #5] Parent must belong to the
-- same company as the child — FK alone only checks parent EXISTS.
create or replace function enforce_account_hierarchy_depth()
returns trigger as $$
declare
  parent_depth smallint;
  parent_company_id uuid;
begin
  if new.parent_account_id is null then
    new.depth := 1;
  else
    select depth, company_id
      into parent_depth, parent_company_id
      from accounts
     where id = new.parent_account_id;
    if parent_depth is null then
      raise exception 'Parent account % not found', new.parent_account_id;
    end if;
    -- Same-company before depth so a cross-tenant parent at max depth does not
    -- surface as a depth error (and does not leak the other company's depth).
    if parent_company_id <> new.company_id then
      raise exception 'Parent account % belongs to a different company',
        new.parent_account_id;
    end if;
    if parent_depth >= 4 then
      raise exception 'Sub-account hierarchy cannot exceed 4 levels deep';
    end if;
    new.depth := parent_depth + 1;
  end if;
  return new;
end;
$$ language plpgsql
   set search_path = public, pg_temp;

create trigger trg_enforce_account_hierarchy_depth
  before insert or update on accounts
  for each row execute function enforce_account_hierarchy_depth();

-- Prevent hard deletion of any account that has ledger history, or is a system account.
-- App layer should set is_active = false ("locking") instead.
create or replace function prevent_account_deletion()
returns trigger as $$
begin
  if old.is_system_account then
    raise exception 'System accounts cannot be deleted';
  end if;
  if exists (select 1 from journal_lines where account_id = old.id) then
    raise exception 'Account % has transaction history — deactivate it (is_active = false), do not delete', old.account_number;
  end if;
  return old;
end;
$$ language plpgsql
   set search_path = public, pg_temp;

create trigger trg_prevent_account_deletion
  before delete on accounts
  for each row execute function prevent_account_deletion();

-- [feature-spec.md decision #58 / §4.9] System-account structural immutability.
-- Mirrors prevent_nondraft_header_mutation: compare NEW vs OLD on the blocked
-- column set only. Metadata (account_name, sub_category, description) stays
-- writable even when is_system_account = true. Nest PATCH still blocks all
-- system-account updates (#36); this is the service_role/DB backstop for
-- structural columns (including is_active / is_system_account un-flag).
-- Uses OLD.is_system_account so clearing the flag cannot bypass the guard.
create or replace function prevent_system_account_mutation()
returns trigger as $$
begin
  if not old.is_system_account then
    return new;
  end if;

  if new.account_number is distinct from old.account_number
     or new.category is distinct from old.category
     or new.normal_balance is distinct from old.normal_balance
     or new.parent_account_id is distinct from old.parent_account_id
     or new.depth is distinct from old.depth
     or new.is_system_account is distinct from old.is_system_account
     or new.company_id is distinct from old.company_id
     or new.is_active is distinct from old.is_active then
    raise exception 'System accounts cannot change structural or identity fields — update account_name, sub_category, or description only';
  end if;

  return new;
end;
$$ language plpgsql
   set search_path = public, pg_temp;

create trigger trg_prevent_system_account_mutation
  before update on accounts
  for each row execute function prevent_system_account_mutation();

-- ============================================================================
-- 3. ACCOUNTING PERIODS
-- ============================================================================

create table accounting_periods (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  period_start    date not null,
  period_end      date not null,
  fiscal_year     int not null,
  status          period_status not null default 'open',

  soft_closed_by  uuid,
  soft_closed_at  timestamptz,
  closed_by       uuid,
  closed_at       timestamptz,
  reopened_by     uuid,
  reopened_at     timestamptz,
  reopen_reason   text,

  created_at      timestamptz not null default now(),

  unique (company_id, period_start, period_end),
  check (period_end > period_start)
);

-- [feature-spec.md decision #38] Overlap backstop matching service-layer predicate
-- (period_start < other.end AND period_end > other.start). Half-open daterange
-- '[)' encodes that predicate so adjacent periods that only share an endpoint
-- (e.g. Jan 1–31 and Feb 1–28) are allowed; true overlaps are rejected.
-- Requires btree_gist (uuid = operator on GiST).
alter table accounting_periods
  add constraint accounting_periods_company_daterange_excl
  exclude using gist (
    company_id with =,
    daterange(period_start, period_end, '[)') with &&
  );

create index idx_periods_company on accounting_periods(company_id);

-- ============================================================================
-- 4. JOURNAL ENTRIES + LINES  (the core double-entry ledger)
-- ============================================================================

create table journal_entries (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references companies(id) on delete cascade,
  entry_number           bigint not null,             -- sequential, human-facing, per company
  period_id              uuid not null references accounting_periods(id),

  entry_date             date not null,
  entry_type             journal_entry_type not null default 'manual',
  status                 journal_entry_status not null default 'draft',

  narration              text not null,
  reference_number       text,

  -- Reversal linkage
  reverses_entry_id      uuid references journal_entries(id),
  reversed_by_entry_id   uuid references journal_entries(id),

  -- Recurring linkage
  recurring_template_id  uuid,                        -- FK added after recurring_journal_templates exists

  -- Approval linkage
  requires_approval      boolean not null default false,
  approved_by            uuid,
  approved_at            timestamptz,
  rejected_by            uuid,
  rejected_at            timestamptz,
  rejection_reason       text,

  created_by             uuid not null,
  posted_at              timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  unique (company_id, entry_number)
);

create index idx_journal_entries_company on journal_entries(company_id);
create index idx_journal_entries_period on journal_entries(period_id);
create index idx_journal_entries_status on journal_entries(company_id, status);
create index idx_journal_entries_date on journal_entries(company_id, entry_date);

create table journal_lines (
  id                  uuid primary key default gen_random_uuid(),
  journal_entry_id    uuid not null references journal_entries(id) on delete cascade,
  line_number         smallint not null,
  account_id          uuid not null references accounts(id),

  debit               numeric(18,2) not null default 0 check (debit >= 0),
  credit              numeric(18,2) not null default 0 check (credit >= 0),

  description         text,
  cost_center         text,                        -- optional dimension, expand later
  created_at          timestamptz not null default now(),

  unique (journal_entry_id, line_number),

  -- a line is either a debit OR a credit, never both, and never zero
  check (
    (debit > 0 and credit = 0) or
    (credit > 0 and debit = 0)
  )
);

create index idx_journal_lines_entry on journal_lines(journal_entry_id);
create index idx_journal_lines_account on journal_lines(account_id);

-- Reject imbalanced entries: enforced whenever an entry is moved to 'posted'.
-- (Draft entries may be temporarily unbalanced while being built in the UI.)
-- [feature-spec.md decision #46 / §7.16 finding #6] Also fires on INSERT so a
-- row inserted directly with status = 'posted' cannot bypass posting rules.
create or replace function enforce_journal_balance_on_post()
returns trigger as $$
declare
  total_debit  numeric(18,2);
  total_credit numeric(18,2);
begin
  if new.status = 'posted' then
    -- INSERT-as-posted is forbidden outright (draft→lines→UPDATE only; #38 pattern).
    -- Never reference OLD on INSERT — OLD is unassigned on INSERT triggers.
    if tg_op = 'INSERT' then
      raise exception 'Journal entry % cannot be inserted directly as posted — create as draft, add lines, then UPDATE to posted',
        new.entry_number;
    end if;

    if old.status is distinct from 'posted' then
      select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
        into total_debit, total_credit
        from journal_lines
        where journal_entry_id = new.id;

      if total_debit <> total_credit then
        raise exception 'Journal entry % is unbalanced: debit % <> credit % — posting rejected',
          new.entry_number, total_debit, total_credit;
      end if;

      if total_debit = 0 then
        raise exception 'Journal entry % has no lines — posting rejected', new.entry_number;
      end if;

      new.posted_at := now();
    end if;
  end if;
  return new;
end;
$$ language plpgsql
   set search_path = public, pg_temp;

drop trigger if exists trg_enforce_journal_balance_on_post on journal_entries;
create trigger trg_enforce_journal_balance_on_post
  before insert or update on journal_entries
  for each row execute function enforce_journal_balance_on_post();

-- Immutability: once posted, an entry's lines cannot be added, edited, or
-- deleted, and the entry itself cannot be deleted — only reversed via a new entry.
-- [feature-spec.md #56] DELETE raises a distinct token so Nest can catch it
-- and write audit_log.delete_blocked in a separate transaction (this RAISE
-- aborts the delete transaction, so an audit insert here would roll back).
create or replace function prevent_posted_line_mutation()
returns trigger as $$
declare
  entry_status journal_entry_status;
begin
  select status into entry_status from journal_entries
    where id = coalesce(new.journal_entry_id, old.journal_entry_id);
  if entry_status = 'posted' then
    if tg_op = 'DELETE' then
      raise exception 'POSTED_LINE_DELETE_BLOCKED';
    end if;
    raise exception 'Cannot modify lines of a posted journal entry — reverse it instead';
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql
   set search_path = public, pg_temp;

create trigger trg_prevent_posted_line_update
  before insert or update or delete on journal_lines
  for each row execute function prevent_posted_line_mutation();

create or replace function prevent_posted_entry_deletion()
returns trigger as $$
begin
  if old.status = 'posted' then
    -- [feature-spec.md #56] Token (not message-match) for Nest audit catch.
    raise exception 'POSTED_ENTRY_DELETE_BLOCKED';
  end if;
  return old;
end;
$$ language plpgsql
   set search_path = public, pg_temp;

create trigger trg_prevent_posted_entry_deletion
  before delete on journal_entries
  for each row execute function prevent_posted_entry_deletion();

-- [feature-spec.md decision #38] Header immutability after draft.
-- Header columns (PATCH /journal-entries/:id / §4.6): narration,
-- reference_number, entry_date. Attachments live on journal_attachments
-- (separate table — not this trigger). Workflow columns that
-- post/approve/reject/reverse/RPCs legitimately update when status is
-- not draft (status, posted_at, approved_*, rejected_*, reversed_by_*,
-- requires_approval, updated_at, …) are allowed.
create or replace function prevent_nondraft_header_mutation()
returns trigger as $$
begin
  if old.status = 'draft' then
    return new;
  end if;

  if new.narration is distinct from old.narration
     or new.reference_number is distinct from old.reference_number
     or new.entry_date is distinct from old.entry_date then
    raise exception 'Cannot modify header of a non-draft journal entry — reverse it instead';
  end if;

  return new;
end;
$$ language plpgsql
   set search_path = public, pg_temp;

create trigger trg_prevent_nondraft_header_mutation
  before update on journal_entries
  for each row execute function prevent_nondraft_header_mutation();

-- ============================================================================
-- 5. ATTACHMENTS
-- ============================================================================

create table journal_attachments (
  id                 uuid primary key default gen_random_uuid(),
  journal_entry_id   uuid not null references journal_entries(id) on delete cascade,
  file_name          text not null,
  file_url           text not null,               -- Supabase Storage path
  file_size_bytes    bigint,
  uploaded_by        uuid not null,
  uploaded_at        timestamptz not null default now()
);

create index idx_attachments_entry on journal_attachments(journal_entry_id);

-- ============================================================================
-- 6. RECURRING JOURNAL TEMPLATES
-- ============================================================================

create table recurring_journal_templates (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  template_name     text not null,                 -- e.g. "Monthly Vehicle Depreciation"
  narration_template text not null,

  frequency         recurrence_frequency not null,
  start_date        date not null,
  end_date          date,                          -- null = indefinite
  next_run_date     date not null,
  day_of_month      smallint check (day_of_month between 1 and 31),

  auto_post         boolean not null default false, -- false = generate as 'draft' for review; true = auto-post
  is_active         boolean not null default true,

  created_by        uuid not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_recurring_templates_company on recurring_journal_templates(company_id);
create index idx_recurring_templates_next_run on recurring_journal_templates(next_run_date) where is_active;

alter table journal_entries
  add constraint fk_journal_entries_recurring_template
  foreign key (recurring_template_id) references recurring_journal_templates(id);

create table recurring_journal_template_lines (
  id                   uuid primary key default gen_random_uuid(),
  template_id          uuid not null references recurring_journal_templates(id) on delete cascade,
  line_number          smallint not null,
  account_id           uuid not null references accounts(id),
  debit                numeric(18,2) not null default 0 check (debit >= 0),
  credit               numeric(18,2) not null default 0 check (credit >= 0),
  description          text,

  unique (template_id, line_number),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);

-- ============================================================================
-- 7. AUDIT LOG  (immutable — INSERT only, no updates, no deletes, ever)
-- ============================================================================

create table audit_log (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  table_name        text not null,
  record_id         uuid not null,
  action            audit_action not null,
  actor_id          uuid not null,
  old_data          jsonb,
  new_data          jsonb,
  notes             text,
  created_at        timestamptz not null default now()
);

create index idx_audit_log_company on audit_log(company_id);
create index idx_audit_log_record on audit_log(table_name, record_id);
create index idx_audit_log_created on audit_log(created_at);

-- Lock the audit log down at the database level: no one, including admins
-- acting through the app role, can UPDATE or DELETE audit rows.
create or replace function block_audit_log_mutation()
returns trigger as $$
begin
  raise exception 'audit_log is immutable — % is not permitted', tg_op;
end;
$$ language plpgsql
   set search_path = public, pg_temp;

create trigger trg_block_audit_log_update
  before update on audit_log
  for each row execute function block_audit_log_mutation();

create trigger trg_block_audit_log_delete
  before delete on audit_log
  for each row execute function block_audit_log_mutation();

-- Generic trigger to auto-log inserts/updates on journal_entries into audit_log.
-- (Attach an equivalent trigger to accounts, journal_lines, periods as needed.)
-- [feature-spec.md #55] Self-approval (approved_by = created_by while entering
-- approved/posted) is labeled in notes at write time — no company_role check;
-- Nest §4.1 already restricts who may approve their own entry.
create or replace function log_journal_entry_change()
returns trigger as $$
declare
  v_notes text := null;
begin
  if tg_op = 'INSERT' then
    insert into audit_log (company_id, table_name, record_id, action, actor_id, new_data)
      values (new.company_id, 'journal_entries', new.id, 'insert'::audit_action, new.created_by, to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    -- NOTE: explicit ::audit_action cast is required here. The CASE
    -- expression's literals resolve to `text` once evaluated inside a
    -- CASE, and Postgres does not implicitly cast text -> enum (only
    -- untyped literals get that implicit coercion). Omitting the cast
    -- causes 42804 (datatype mismatch) on every UPDATE to journal_entries.
    if new.approved_by is not null
       and new.approved_by = new.created_by
       and new.status in ('approved', 'posted')
       and old.status is distinct from new.status
       and old.status not in ('approved', 'posted') then
      v_notes := 'Self-approved by Owner';
    end if;

    insert into audit_log (company_id, table_name, record_id, action, actor_id, old_data, new_data, notes)
      values (new.company_id, 'journal_entries', new.id,
        (case when new.status = 'reversed' then 'reversal' else 'status_change' end)::audit_action,
        coalesce(new.approved_by, new.created_by), to_jsonb(old), to_jsonb(new), v_notes);
  end if;
  return new;
end;
$$ language plpgsql
   set search_path = public, pg_temp;

create trigger trg_log_journal_entry_change
  after insert or update on journal_entries
  for each row execute function log_journal_entry_change();

-- ============================================================================
-- 7. CUSTOMERS (Module 1.1.C — feature-spec-1.1.C.md §1.1)
-- ============================================================================

create table customers (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references companies(id) on delete cascade,
  customer_name          text not null,
  trn                    text,                            -- nullable; FTA Tax Registration Number
  email                  text,
  phone                  text,
  billing_address        text,
  default_payment_terms  text,                            -- §5 enum lands with invoices; text default for now
  is_active              boolean not null default true,   -- soft deactivate; no hard delete
  -- [feature-spec-1_1_D.md §3.1] null = no credit limit enforced
  credit_limit           numeric(18,2),
  -- [feature-spec-1_1_D.md §3.4b] manual ECL override for named high-risk cases
  ecl_override_rate      numeric(6,4),
  ecl_override_reason    text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint customers_ecl_override_reason_required check (
    ecl_override_rate is null
    or (ecl_override_reason is not null and btrim(ecl_override_reason) <> '')
  )
);

create index idx_customers_company on customers(company_id);

-- [feature-spec-1.1.C.md decision #1] Partial unique — duplicate TRN within one company = same legal entity twice
create unique index customers_company_trn_unique
  on customers(company_id, trn)
  where trn is not null;

-- ============================================================================
-- 7b. QUOTATIONS (Module 1.1.C — feature-spec-1.1.C.md §1.2, §2.1, §3)
-- ============================================================================

create type quotation_status as enum (
  'draft',
  'sent',
  'viewed',
  'accepted',
  'declined',
  'expired'
);

create table quotations (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references companies(id) on delete cascade,
  customer_id              uuid not null references customers(id),
  quotation_number         text not null,
  quotation_date           date not null,
  valid_until              date,
  status                   quotation_status not null default 'draft',
  subtotal                 numeric(18,2) not null default 0,
  vat_total                numeric(18,2) not null default 0,
  grand_total              numeric(18,2) not null default 0,
  notes                    text,
  converted_to_invoice_id  uuid,
  created_by               uuid not null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  unique (company_id, quotation_number)
);

create index idx_quotations_company on quotations(company_id);
create index idx_quotations_customer on quotations(customer_id);
create index idx_quotations_status on quotations(company_id, status);

create table quotation_lines (
  id                uuid primary key default gen_random_uuid(),
  quotation_id      uuid not null references quotations(id) on delete cascade,
  line_number       smallint not null,
  description       text not null,
  quantity          numeric(18,4) not null check (quantity > 0),
  unit_price        numeric(18,2) not null check (unit_price >= 0),
  discount_percent  numeric(5,2) check (discount_percent is null or (discount_percent > 0 and discount_percent <= 100)),
  discount_amount   numeric(18,2) check (discount_amount is null or discount_amount > 0),
  vat_rate          numeric(5,2) not null check (vat_rate >= 0 and vat_rate <= 100),
  is_service        boolean not null default false,
  line_total        numeric(18,2) not null default 0,
  -- [feature-spec-1_1_F.md F-19 / F-43] nullable until convert/Issue
  vat_category      vat_category,
  emirate           uae_emirate,

  unique (quotation_id, line_number),

  -- [feature-spec-1.1.C.md decision #2] percent XOR amount, or neither (0 discount)
  check (
    (discount_percent is null and discount_amount is null)
    or (discount_percent is not null and discount_amount is null)
    or (discount_percent is null and discount_amount is not null)
  )
);

create index idx_quotation_lines_quotation on quotation_lines(quotation_id);

-- [feature-spec-1.1.C.md decision #16] quo: advisory lock; format QUO-YYYY-NNNN
create or replace function allocate_next_quotation_number(
  p_company_id uuid,
  p_quotation_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year int;
  v_seq  int;
begin
  if p_company_id is null then
    raise exception 'COMPANY_ID_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtext('quo:' || p_company_id::text));

  v_year := extract(year from coalesce(p_quotation_date, current_date))::int;

  select coalesce(
    max(
      nullif(
        regexp_replace(quotation_number, '^QUO-' || v_year::text || '-', ''),
        quotation_number
      )::int
    ),
    0
  ) + 1
    into v_seq
    from quotations
   where company_id = p_company_id
     and quotation_number ~ ('^QUO-' || v_year::text || '-[0-9]+$');

  return format('QUO-%s-%s', v_year, lpad(v_seq::text, 4, '0'));
end;
$$;

revoke all on function allocate_next_quotation_number(uuid, date) from public;
revoke all on function allocate_next_quotation_number(uuid, date) from authenticated;
revoke all on function allocate_next_quotation_number(uuid, date) from anon;
grant execute on function allocate_next_quotation_number(uuid, date) to service_role;

create or replace function assign_quotation_number()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.quotation_number is null or btrim(new.quotation_number) = '' then
    new.quotation_number := allocate_next_quotation_number(new.company_id, new.quotation_date);
  end if;
  return new;
end;
$$;

create trigger trg_assign_quotation_number
  before insert on quotations
  for each row execute function assign_quotation_number();

-- Line net / VAT / inclusive total helper
create or replace function compute_quotation_line_amounts(
  p_quantity numeric,
  p_unit_price numeric,
  p_discount_percent numeric,
  p_discount_amount numeric,
  p_vat_rate numeric,
  out line_net numeric,
  out line_vat numeric,
  out line_total numeric
)
language plpgsql
immutable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_gross    numeric(18,2);
  v_discount numeric(18,2);
begin
  v_gross := round(p_quantity * p_unit_price, 2);

  if p_discount_percent is not null then
    v_discount := round(v_gross * p_discount_percent / 100, 2);
  elsif p_discount_amount is not null then
    v_discount := p_discount_amount;
  else
    v_discount := 0;
  end if;

  line_net := round(v_gross - v_discount, 2);
  line_vat := round(line_net * p_vat_rate / 100, 2);
  line_total := line_net + line_vat;
end;
$$;

-- [feature-spec-1.1.C.md decision #3] Recompute header totals from lines while draft.
create or replace function recalculate_quotation_totals(p_quotation_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status quotation_status;
  v_subtotal numeric(18,2) := 0;
  v_vat_total numeric(18,2) := 0;
  v_line record;
  v_net numeric(18,2);
  v_vat numeric(18,2);
  v_total numeric(18,2);
begin
  select status into v_status
    from quotations
   where id = p_quotation_id;

  if not found or v_status <> 'draft' then
    return;
  end if;

  for v_line in
    select quantity, unit_price, discount_percent, discount_amount, vat_rate
      from quotation_lines
     where quotation_id = p_quotation_id
     order by line_number
  loop
    select * into v_net, v_vat, v_total
      from compute_quotation_line_amounts(
        v_line.quantity,
        v_line.unit_price,
        v_line.discount_percent,
        v_line.discount_amount,
        v_line.vat_rate
      );
    v_subtotal := v_subtotal + v_net;
    v_vat_total := v_vat_total + v_vat;
  end loop;

  perform set_config('app.quotation_recalc_in_progress', 'true', true);

  -- [feature-spec-1.1.C.md §1.2] Diagnostic only: integration tests set
  -- app.quotation_recalc_trace=true in the same transaction to assert this
  -- function runs exactly once per line mutation (no header→line cascade).
  if current_setting('app.quotation_recalc_trace', true) = 'true' then
    perform set_config(
      'app.quotation_recalc_call_count',
      (coalesce(nullif(current_setting('app.quotation_recalc_call_count', true), ''), '0')::int + 1)::text,
      true
    );
  end if;

  update quotations
     set subtotal = v_subtotal,
         vat_total = v_vat_total,
         grand_total = v_subtotal + v_vat_total,
         updated_at = now()
   where id = p_quotation_id
     and status = 'draft';

  perform set_config('app.quotation_recalc_in_progress', '', true);
end;
$$;

create or replace function set_quotation_line_computed_fields()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_net numeric(18,2);
  v_vat numeric(18,2);
  v_total numeric(18,2);
begin
  select * into v_net, v_vat, v_total
    from compute_quotation_line_amounts(
      new.quantity,
      new.unit_price,
      new.discount_percent,
      new.discount_amount,
      new.vat_rate
    );
  new.line_total := v_total;
  return new;
end;
$$;

create trigger trg_set_quotation_line_computed_fields
  before insert or update on quotation_lines
  for each row execute function set_quotation_line_computed_fields();

create or replace function refresh_quotation_totals_from_lines()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_setting('app.quotation_recalc_trace', true) = 'true' then
    perform set_config(
      'app.quotation_line_trigger_count',
      (coalesce(nullif(current_setting('app.quotation_line_trigger_count', true), ''), '0')::int + 1)::text,
      true
    );
  end if;

  perform recalculate_quotation_totals(coalesce(new.quotation_id, old.quotation_id));
  return coalesce(new, old);
end;
$$;

create trigger trg_refresh_quotation_totals_from_lines
  after insert or update or delete on quotation_lines
  for each row execute function refresh_quotation_totals_from_lines();

-- [feature-spec-1.1.C.md decision #3] Block line mutations once parent leaves draft.
create or replace function prevent_nondraft_quotation_line_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status quotation_status;
begin
  select status into v_status
    from quotations
   where id = coalesce(new.quotation_id, old.quotation_id);

  if v_status <> 'draft' then
    raise exception 'QUOTATION_LINE_MUTATION_BLOCKED';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger trg_prevent_nondraft_quotation_line_mutation
  before insert or update or delete on quotation_lines
  for each row execute function prevent_nondraft_quotation_line_mutation();

-- Block client writes to computed totals; allow recalc trigger via session GUC.
create or replace function prevent_quotation_computed_totals_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_setting('app.quotation_recalc_in_progress', true) = 'true' then
    return new;
  end if;

  if new.subtotal is distinct from old.subtotal
     or new.vat_total is distinct from old.vat_total
     or new.grand_total is distinct from old.grand_total then
    raise exception 'QUOTATION_TOTALS_CLIENT_MUTATION_BLOCKED';
  end if;

  return new;
end;
$$;

create trigger trg_prevent_quotation_computed_totals_mutation
  before update on quotations
  for each row execute function prevent_quotation_computed_totals_mutation();

-- [feature-spec-1.1.C.md decision #3] Header metadata locked once non-draft (status workflow allowed).
create or replace function prevent_nondraft_quotation_header_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.status = 'draft' then
    return new;
  end if;

  if new.customer_id is distinct from old.customer_id
     or new.quotation_date is distinct from old.quotation_date
     or new.valid_until is distinct from old.valid_until
     or new.notes is distinct from old.notes
     or new.quotation_number is distinct from old.quotation_number then
    raise exception 'QUOTATION_HEADER_MUTATION_BLOCKED';
  end if;

  return new;
end;
$$;

create trigger trg_prevent_nondraft_quotation_header_mutation
  before update on quotations
  for each row execute function prevent_nondraft_quotation_header_mutation();

-- Integration-only: same-transaction trace for recalc trigger depth (not a product API).
create or replace function integration_verify_quotation_recalc_fires_once(
  p_line_id uuid,
  p_quantity numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform set_config('app.quotation_recalc_trace', 'true', true);
  perform set_config('app.quotation_recalc_call_count', '0', true);
  perform set_config('app.quotation_line_trigger_count', '0', true);

  update quotation_lines
     set quantity = p_quantity
   where id = p_line_id;

  return jsonb_build_object(
    'line_trigger_fires', current_setting('app.quotation_line_trigger_count', true)::int,
    'recalc_calls', current_setting('app.quotation_recalc_call_count', true)::int
  );
end;
$$;

revoke all on function integration_verify_quotation_recalc_fires_once(uuid, numeric) from public;
revoke all on function integration_verify_quotation_recalc_fires_once(uuid, numeric) from authenticated;
revoke all on function integration_verify_quotation_recalc_fires_once(uuid, numeric) from anon;
grant execute on function integration_verify_quotation_recalc_fires_once(uuid, numeric) to service_role;

revoke all on function assign_quotation_number() from public;
revoke all on function assign_quotation_number() from authenticated;
revoke all on function assign_quotation_number() from anon;
grant execute on function assign_quotation_number() to service_role;

revoke all on function compute_quotation_line_amounts(numeric, numeric, numeric, numeric, numeric) from public;
revoke all on function compute_quotation_line_amounts(numeric, numeric, numeric, numeric, numeric) from authenticated;
revoke all on function compute_quotation_line_amounts(numeric, numeric, numeric, numeric, numeric) from anon;
grant execute on function compute_quotation_line_amounts(numeric, numeric, numeric, numeric, numeric) to service_role;

revoke all on function recalculate_quotation_totals(uuid) from public;
revoke all on function recalculate_quotation_totals(uuid) from authenticated;
revoke all on function recalculate_quotation_totals(uuid) from anon;
grant execute on function recalculate_quotation_totals(uuid) to service_role;

revoke all on function set_quotation_line_computed_fields() from public;
revoke all on function set_quotation_line_computed_fields() from authenticated;
revoke all on function set_quotation_line_computed_fields() from anon;
grant execute on function set_quotation_line_computed_fields() to service_role;

revoke all on function refresh_quotation_totals_from_lines() from public;
revoke all on function refresh_quotation_totals_from_lines() from authenticated;
revoke all on function refresh_quotation_totals_from_lines() from anon;
grant execute on function refresh_quotation_totals_from_lines() to service_role;

revoke all on function prevent_nondraft_quotation_line_mutation() from public;
revoke all on function prevent_nondraft_quotation_line_mutation() from authenticated;
revoke all on function prevent_nondraft_quotation_line_mutation() from anon;
grant execute on function prevent_nondraft_quotation_line_mutation() to service_role;

revoke all on function prevent_quotation_computed_totals_mutation() from public;
revoke all on function prevent_quotation_computed_totals_mutation() from authenticated;
revoke all on function prevent_quotation_computed_totals_mutation() from anon;
grant execute on function prevent_quotation_computed_totals_mutation() to service_role;

revoke all on function prevent_nondraft_quotation_header_mutation() from public;
revoke all on function prevent_nondraft_quotation_header_mutation() from authenticated;
revoke all on function prevent_nondraft_quotation_header_mutation() from anon;
grant execute on function prevent_nondraft_quotation_header_mutation() to service_role;

-- [feature-spec-1.1.C.md §2.1 / §8 decision #6] Scheduled valid_until → Expired transition.
-- Exception token: COMPANY_ID_REQUIRED
create or replace function expire_due_quotations(p_company_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  if p_company_id is null then
    raise exception 'COMPANY_ID_REQUIRED';
  end if;

  -- [feature-spec-1.1.C.md §8 / decision #15] qxp: per-company namespace — same
  -- pattern as ob:/ye:/rjt:/quo:/inv:/crn:/cnl: advisory locks.
  perform pg_advisory_xact_lock(hashtext('qxp:' || p_company_id::text));

  update quotations
     set status = 'expired',
         updated_at = now()
   where company_id = p_company_id
     and status in ('draft', 'sent', 'viewed')
     and valid_until is not null
     and valid_until < current_date;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function expire_due_quotations(uuid) from public;
revoke all on function expire_due_quotations(uuid) from authenticated;
revoke all on function expire_due_quotations(uuid) from anon;
grant execute on function expire_due_quotations(uuid) to service_role;

-- ============================================================================
-- 7c. INVOICES (Module 1.1.C — feature-spec-1.1.C.md §1.3, §2.2, §3, §5, §6.2)
-- Numbering at Issue (#8), not INSERT (#16 quotations). Ledger posting §7
-- via create_invoice_journal_entry wired into issue_invoice (decision #12).
-- ============================================================================

create type payment_terms_type as enum (
  'net_7', 'net_15', 'net_30', 'net_60', 'custom', 'cod'
);

create type invoice_type as enum (
  'tax_invoice', 'simplified_tax_invoice', 'proforma'
);

create type invoice_status as enum (
  'draft',
  'issued',
  'sent',
  'viewed',
  'partially_paid',
  'paid',
  'overdue',
  'written_off',
  'void'
);

create table invoices (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  customer_id           uuid not null references customers(id),
  invoice_number        text,
  invoice_type          invoice_type,
  invoice_date          date not null,
  due_date              date,
  payment_terms         payment_terms_type not null default 'net_30',
  custom_days           int,
  status                invoice_status not null default 'draft',
  subtotal              numeric(18,2) not null default 0,
  vat_total             numeric(18,2) not null default 0,
  grand_total           numeric(18,2) not null default 0,
  amount_paid           numeric(18,2) not null default 0,
  -- [feature-spec-1_1_D.md §3.5 / D-3] set once when amount_paid reaches grand_total
  paid_at               timestamptz,
  source_quotation_id   uuid references quotations(id),
  journal_entry_id      uuid references journal_entries(id),
  void_reason           text,
  created_by            uuid not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint invoices_custom_days_required check (
    payment_terms <> 'custom' or (custom_days is not null and custom_days > 0)
  ),
  constraint invoices_void_reason_required check (
    status <> 'void' or (void_reason is not null and btrim(void_reason) <> '')
  )
);

create unique index invoices_company_number_unique
  on invoices(company_id, invoice_number)
  where invoice_number is not null;

create index idx_invoices_company on invoices(company_id);
create index idx_invoices_customer on invoices(customer_id);
create index idx_invoices_status on invoices(company_id, status);

create table invoice_lines (
  id                 uuid primary key default gen_random_uuid(),
  invoice_id         uuid not null references invoices(id) on delete cascade,
  line_number        smallint not null,
  description        text not null,
  quantity           numeric(18,4) not null,
  unit_price         numeric(18,2) not null,
  discount_percent   numeric(5,2),
  discount_amount    numeric(18,2),
  vat_rate           numeric(5,2) not null,
  is_service         boolean not null default false,
  income_account_id  uuid references accounts(id),
  line_total         numeric(18,2) not null default 0,
  -- [feature-spec-1_1_F.md F-19 / F-43] nullable until Issue
  vat_category       vat_category,
  emirate            uae_emirate,
  unique (invoice_id, line_number),
  constraint invoice_lines_discount_xor check (
    not (discount_percent is not null and discount_amount is not null)
  )
);

create index idx_invoice_lines_invoice on invoice_lines(invoice_id);

-- [feature-spec-1.1.C.md decision #8] inv: lock; format INV-YYYY-NNNN; Issue only.
create or replace function allocate_next_invoice_number(
  p_company_id uuid,
  p_invoice_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year int;
  v_seq  int;
begin
  if p_company_id is null then
    raise exception 'COMPANY_ID_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtext('inv:' || p_company_id::text));

  v_year := extract(year from coalesce(p_invoice_date, current_date))::int;

  select coalesce(
    max(
      nullif(
        regexp_replace(invoice_number, '^INV-' || v_year::text || '-', ''),
        invoice_number
      )::int
    ),
    0
  ) + 1
    into v_seq
    from invoices
   where company_id = p_company_id
     and invoice_number ~ ('^INV-' || v_year::text || '-[0-9]+$');

  return format('INV-%s-%s', v_year, lpad(v_seq::text, 4, '0'));
end;
$$;

revoke all on function allocate_next_invoice_number(uuid, date) from public;
revoke all on function allocate_next_invoice_number(uuid, date) from authenticated;
revoke all on function allocate_next_invoice_number(uuid, date) from anon;
grant execute on function allocate_next_invoice_number(uuid, date) to service_role;

-- Shared line math — same function as quotations (feature-spec-1.1.C.md §1.3 / §1.2).

create or replace function suggest_invoice_line_income_account()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_account_number char(4);
  v_account_id uuid;
begin
  if new.income_account_id is not null then
    return new;
  end if;

  select company_id into v_company_id from invoices where id = new.invoice_id;
  if v_company_id is null then
    return new;
  end if;

  -- [feature-spec-1_1_F.md F-19] vat_category wins when set; vat_rate heuristic for legacy drafts.
  if new.vat_category = 'standard_rated' then
    if coalesce(new.is_service, false) then
      v_account_number := '4040';
    else
      v_account_number := '4000';
    end if;
  elsif new.vat_category = 'zero_rated' then
    v_account_number := '4010';
  elsif new.vat_category = 'exempt' then
    v_account_number := '4020';
  elsif new.vat_category = 'designated_zone' then
    v_account_number := '4030';
  elsif new.vat_category = 'out_of_scope' then
    return new;
  elsif new.vat_rate = 5 then
    if coalesce(new.is_service, false) then
      v_account_number := '4040';
    else
      v_account_number := '4000';
    end if;
  elsif new.vat_rate = 0 then
    v_account_number := '4010';
  else
    v_account_number := '4020';
  end if;

  select id into v_account_id
    from accounts
   where company_id = v_company_id
     and account_number = v_account_number
     and (v_account_number <> '4030' or is_active = true)
   limit 1;

  if v_account_id is not null then
    new.income_account_id := v_account_id;
  end if;

  return new;
end;
$$;

create trigger trg_suggest_invoice_line_income_account
  before insert or update on invoice_lines
  for each row execute function suggest_invoice_line_income_account();

create or replace function set_invoice_line_computed_fields()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_net numeric(18,2);
  v_vat numeric(18,2);
  v_total numeric(18,2);
begin
  select * into v_net, v_vat, v_total
    from compute_quotation_line_amounts(
      new.quantity,
      new.unit_price,
      new.discount_percent,
      new.discount_amount,
      new.vat_rate
    );
  new.line_total := v_total;
  return new;
end;
$$;

create trigger trg_set_invoice_line_computed_fields
  before insert or update on invoice_lines
  for each row execute function set_invoice_line_computed_fields();

create or replace function recalculate_invoice_totals(p_invoice_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status invoice_status;
  v_subtotal numeric(18,2) := 0;
  v_vat_total numeric(18,2) := 0;
  v_line record;
  v_net numeric(18,2);
  v_vat numeric(18,2);
  v_total numeric(18,2);
begin
  select status into v_status from invoices where id = p_invoice_id;

  if not found or v_status <> 'draft' then
    return;
  end if;

  for v_line in
    select quantity, unit_price, discount_percent, discount_amount, vat_rate
      from invoice_lines
     where invoice_id = p_invoice_id
     order by line_number
  loop
    select * into v_net, v_vat, v_total
      from compute_quotation_line_amounts(
        v_line.quantity,
        v_line.unit_price,
        v_line.discount_percent,
        v_line.discount_amount,
        v_line.vat_rate
      );
    v_subtotal := v_subtotal + v_net;
    v_vat_total := v_vat_total + v_vat;
  end loop;

  perform set_config('app.invoice_recalc_in_progress', 'true', true);

  -- [feature-spec-1.1.C.md §1.3] Diagnostic only: integration tests set
  -- app.invoice_recalc_trace=true in the same transaction to assert this
  -- function runs exactly once per line mutation (no header→line cascade).
  if current_setting('app.invoice_recalc_trace', true) = 'true' then
    perform set_config(
      'app.invoice_recalc_call_count',
      (coalesce(nullif(current_setting('app.invoice_recalc_call_count', true), ''), '0')::int + 1)::text,
      true
    );
  end if;

  update invoices
     set subtotal = v_subtotal,
         vat_total = v_vat_total,
         grand_total = v_subtotal + v_vat_total,
         updated_at = now()
   where id = p_invoice_id
     and status = 'draft';

  perform set_config('app.invoice_recalc_in_progress', '', true);
end;
$$;

create or replace function refresh_invoice_totals_from_lines()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_setting('app.invoice_recalc_trace', true) = 'true' then
    perform set_config(
      'app.invoice_line_trigger_count',
      (coalesce(nullif(current_setting('app.invoice_line_trigger_count', true), ''), '0')::int + 1)::text,
      true
    );
  end if;

  perform recalculate_invoice_totals(coalesce(new.invoice_id, old.invoice_id));
  return coalesce(new, old);
end;
$$;

create trigger trg_refresh_invoice_totals_from_lines
  after insert or update or delete on invoice_lines
  for each row execute function refresh_invoice_totals_from_lines();

create or replace function prevent_nondraft_invoice_line_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status invoice_status;
begin
  select status into v_status
    from invoices
   where id = coalesce(new.invoice_id, old.invoice_id);

  if v_status = 'draft' then
    return coalesce(new, old);
  end if;

  raise exception 'INVOICE_LINE_MUTATION_BLOCKED';
end;
$$;

create trigger trg_prevent_nondraft_invoice_line_mutation
  before insert or update or delete on invoice_lines
  for each row execute function prevent_nondraft_invoice_line_mutation();

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

create trigger trg_prevent_invoice_computed_totals_mutation
  before update on invoices
  for each row execute function prevent_invoice_computed_totals_mutation();

create or replace function prevent_nondraft_invoice_header_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.status = 'draft' then
    return new;
  end if;

  if new.customer_id is distinct from old.customer_id
     or new.invoice_date is distinct from old.invoice_date
     or new.payment_terms is distinct from old.payment_terms
     or new.custom_days is distinct from old.custom_days
     or new.invoice_number is distinct from old.invoice_number
     or new.invoice_type is distinct from old.invoice_type
     or new.due_date is distinct from old.due_date
     or new.source_quotation_id is distinct from old.source_quotation_id then
    raise exception 'INVOICE_HEADER_MUTATION_BLOCKED';
  end if;

  return new;
end;
$$;

create trigger trg_prevent_nondraft_invoice_header_mutation
  before update on invoices
  for each row execute function prevent_nondraft_invoice_header_mutation();

-- [feature-spec-1.1.C.md §7 decision #12] Atomic sales-invoice ledger posting at Issue.
-- Exception tokens: CREATED_BY_REQUIRED, INVOICE_NOT_FOUND, INVOICE_JOURNAL_ALREADY_POSTED,
-- INVOICE_REQUIRES_LINES, INVOICE_POSTING_ACCOUNT_NOT_FOUND, INVOICE_LINE_MISSING_INCOME_ACCOUNT,
-- NO_OPEN_PERIOD_FOR_INVOICE_DATE, INVOICE_POSTING_UNBALANCED
create or replace function create_invoice_journal_entry(
  p_invoice_id uuid,
  p_created_by uuid,
  p_reference_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice        invoices%rowtype;
  v_period         accounting_periods%rowtype;
  v_entry_number   bigint;
  v_entry          journal_entries%rowtype;
  v_lines          jsonb;
  v_line           record;
  v_ar_id          uuid;
  v_discount_id    uuid;
  v_vat_id         uuid;
  v_line_number    int := 0;
  v_gross          numeric(18,2);
  v_discount       numeric(18,2);
  v_net            numeric(18,2);
  v_vat            numeric(18,2);
  v_total          numeric(18,2);
  v_gross_sum      numeric(18,2) := 0;
  v_discount_sum   numeric(18,2) := 0;
  v_total_debits   numeric(18,2);
  v_total_credits  numeric(18,2);
  v_ref            text;
begin
  if p_created_by is null then
    raise exception 'CREATED_BY_REQUIRED';
  end if;

  select * into v_invoice from invoices where id = p_invoice_id;
  if not found then
    raise exception 'INVOICE_NOT_FOUND';
  end if;

  if v_invoice.journal_entry_id is not null then
    raise exception 'INVOICE_JOURNAL_ALREADY_POSTED';
  end if;

  if not exists (select 1 from invoice_lines where invoice_id = p_invoice_id) then
    raise exception 'INVOICE_REQUIRES_LINES';
  end if;

  select id into v_ar_id
    from accounts
   where company_id = v_invoice.company_id
     and account_number = '1100';
  if v_ar_id is null then
    raise exception 'INVOICE_POSTING_ACCOUNT_NOT_FOUND';
  end if;

  select id into v_discount_id
    from accounts
   where company_id = v_invoice.company_id
     and account_number = '4060';
  if v_discount_id is null then
    raise exception 'INVOICE_POSTING_ACCOUNT_NOT_FOUND';
  end if;

  select id into v_vat_id
    from accounts
   where company_id = v_invoice.company_id
     and account_number = '2200';
  if v_vat_id is null then
    raise exception 'INVOICE_POSTING_ACCOUNT_NOT_FOUND';
  end if;

  -- [schema.sql accounting_periods] Half-open [period_start, period_end).
  select * into v_period
    from accounting_periods
   where company_id = v_invoice.company_id
     and status = 'open'
     and period_start <= v_invoice.invoice_date
     and period_end > v_invoice.invoice_date
   order by period_start
   limit 1;

  if not found then
    raise exception 'NO_OPEN_PERIOD_FOR_INVOICE_DATE';
  end if;

  for v_line in
    select il.*
      from invoice_lines il
     where il.invoice_id = p_invoice_id
     order by il.line_number
  loop
    if v_line.income_account_id is null then
      raise exception 'INVOICE_LINE_MISSING_INCOME_ACCOUNT';
    end if;

    v_gross := round(v_line.quantity * v_line.unit_price, 2);

    if v_line.discount_percent is not null then
      v_discount := round(v_gross * v_line.discount_percent / 100, 2);
    elsif v_line.discount_amount is not null then
      v_discount := v_line.discount_amount;
    else
      v_discount := 0;
    end if;

    v_gross_sum := v_gross_sum + v_gross;
    v_discount_sum := v_discount_sum + v_discount;
  end loop;

  v_total_debits := v_invoice.grand_total + v_discount_sum;
  v_total_credits := v_gross_sum + v_invoice.vat_total;

  if v_total_debits <> v_total_credits then
    raise exception 'INVOICE_POSTING_UNBALANCED';
  end if;

  v_ref := coalesce(nullif(btrim(p_reference_number), ''), v_invoice.invoice_number);

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
    v_invoice.invoice_date,
    'sales_invoice',
    'draft',
    case
      when v_ref is not null then 'Sales invoice ' || v_ref
      else 'Sales invoice'
    end,
    v_ref,
    p_created_by
  )
  returning * into v_entry;

  v_line_number := v_line_number + 1;
  insert into journal_lines (
    journal_entry_id,
    line_number,
    account_id,
    debit,
    credit,
    description
  ) values (
    v_entry.id,
    v_line_number,
    v_ar_id,
    v_invoice.grand_total,
    0,
    'Accounts Receivable - Trade'
  );

  for v_line in
    select il.*
      from invoice_lines il
     where il.invoice_id = p_invoice_id
     order by il.line_number
  loop
    v_gross := round(v_line.quantity * v_line.unit_price, 2);
    v_line_number := v_line_number + 1;
    insert into journal_lines (
      journal_entry_id,
      line_number,
      account_id,
      debit,
      credit,
      description
    ) values (
      v_entry.id,
      v_line_number,
      v_line.income_account_id,
      0,
      v_gross,
      v_line.description
    );
  end loop;

  if v_discount_sum > 0 then
    v_line_number := v_line_number + 1;
    insert into journal_lines (
      journal_entry_id,
      line_number,
      account_id,
      debit,
      credit,
      description
    ) values (
      v_entry.id,
      v_line_number,
      v_discount_id,
      v_discount_sum,
      0,
      'Sales Discounts Given'
    );
  end if;

  if v_invoice.vat_total > 0 then
    v_line_number := v_line_number + 1;
    insert into journal_lines (
      journal_entry_id,
      line_number,
      account_id,
      debit,
      credit,
      description
    ) values (
      v_entry.id,
      v_line_number,
      v_vat_id,
      0,
      v_invoice.vat_total,
      'VAT Payable - Output VAT'
    );
  end if;

  update journal_entries
     set status = 'posted'
   where id = v_entry.id
     and status = 'draft'
  returning * into v_entry;

  if not found then
    raise exception 'Failed to post sales invoice entry %', v_entry_number;
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

revoke all on function create_invoice_journal_entry(uuid, uuid, text) from public;
revoke all on function create_invoice_journal_entry(uuid, uuid, text) from authenticated;
revoke all on function create_invoice_journal_entry(uuid, uuid, text) from anon;
grant execute on function create_invoice_journal_entry(uuid, uuid, text) to service_role;

-- [feature-spec-1.1.C.md §2.2 / §6.2 / decision #8 / §7 decision #12] Issue:
-- number, due_date, invoice_type, and sales-invoice ledger posting.
create or replace function issue_invoice(
  p_invoice_id uuid,
  p_invoice_type_override invoice_type default null
)
returns invoices
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice invoices%rowtype;
  v_customer_trn text;
  v_auto_type invoice_type;
  v_final_type invoice_type;
  v_due_date date;
  v_number text;
  v_journal_result jsonb;
  v_journal_entry_id uuid;
begin
  select * into v_invoice from invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'INVOICE_NOT_FOUND';
  end if;

  if v_invoice.status <> 'draft' then
    raise exception 'INVOICE_NOT_DRAFT';
  end if;

  if not exists (select 1 from invoice_lines where invoice_id = p_invoice_id) then
    raise exception 'INVOICE_REQUIRES_LINES';
  end if;

  -- [feature-spec-1_1_F.md F-19 / F-38 / F-43]
  perform assert_invoice_vat_ready(p_invoice_id);
  perform assert_not_filed_vat_period(
    v_invoice.company_id, v_invoice.invoice_date, false, true
  );

  select trn into v_customer_trn from customers where id = v_invoice.customer_id;

  if v_customer_trn is null or btrim(v_customer_trn) = '' then
    v_auto_type := 'simplified_tax_invoice';
  elsif v_invoice.grand_total > 10000 then
    v_auto_type := 'tax_invoice';
  else
    v_auto_type := 'simplified_tax_invoice';
  end if;

  if p_invoice_type_override is not null then
    if p_invoice_type_override = 'simplified_tax_invoice'
       and v_auto_type = 'tax_invoice' then
      raise exception 'INVOICE_TYPE_OVERRIDE_NOT_PERMITTED';
    end if;
    if p_invoice_type_override = 'tax_invoice' then
      v_final_type := 'tax_invoice';
    else
      v_final_type := v_auto_type;
    end if;
  else
    v_final_type := v_auto_type;
  end if;

  v_due_date := case v_invoice.payment_terms
    when 'net_7' then v_invoice.invoice_date + 7
    when 'net_15' then v_invoice.invoice_date + 15
    when 'net_30' then v_invoice.invoice_date + 30
    when 'net_60' then v_invoice.invoice_date + 60
    when 'custom' then v_invoice.invoice_date + v_invoice.custom_days
    when 'cod' then v_invoice.invoice_date
  end;

  v_number := allocate_next_invoice_number(v_invoice.company_id, v_invoice.invoice_date);

  v_journal_result := create_invoice_journal_entry(
    p_invoice_id,
    v_invoice.created_by,
    v_number
  );
  v_journal_entry_id := (v_journal_result->>'journal_entry_id')::uuid;

  update invoices
     set status = 'issued',
         invoice_number = v_number,
         invoice_type = v_final_type,
         due_date = v_due_date,
         journal_entry_id = v_journal_entry_id,
         updated_at = now()
   where id = p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$$;

revoke all on function issue_invoice(uuid, invoice_type) from public;
revoke all on function issue_invoice(uuid, invoice_type) from authenticated;
revoke all on function issue_invoice(uuid, invoice_type) from anon;
grant execute on function issue_invoice(uuid, invoice_type) to service_role;

-- [feature-spec-1.1.C.md §2.2 / §7] Void invoice + optional ledger reversal in one transaction.
-- Exception tokens: CREATED_BY_REQUIRED, VOID_REASON_REQUIRED, INVOICE_NOT_FOUND,
-- INVOICE_VOID_NOT_PERMITTED
create or replace function void_invoice(
  p_invoice_id uuid,
  p_void_reason text,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice          invoices%rowtype;
  v_reversal_result  jsonb;
  v_ledger_status    text;
begin
  if p_created_by is null then
    raise exception 'CREATED_BY_REQUIRED';
  end if;

  if p_void_reason is null or btrim(p_void_reason) = '' then
    raise exception 'VOID_REASON_REQUIRED';
  end if;

  select * into v_invoice from invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'INVOICE_NOT_FOUND';
  end if;

  -- [feature-spec-1.1.C.md §2.2] Same statuses Nest allows Issued → Void (and later CRM states).
  if v_invoice.status not in ('issued', 'sent', 'viewed', 'overdue') then
    raise exception 'INVOICE_VOID_NOT_PERMITTED';
  end if;

  -- [feature-spec-1_1_F.md F-38]
  perform assert_not_filed_vat_period(
    v_invoice.company_id, v_invoice.invoice_date, false, true
  );

  if v_invoice.journal_entry_id is not null then
    v_reversal_result := reverse_journal_entry(v_invoice.journal_entry_id, p_created_by);
    v_ledger_status := 'reversed';
  else
    v_reversal_result := null;
    v_ledger_status := 'skipped_no_posting';
  end if;

  update invoices
     set status = 'void',
         void_reason = btrim(p_void_reason),
         updated_at = now()
   where id = p_invoice_id
  returning * into v_invoice;

  return jsonb_build_object(
    'invoice', to_jsonb(v_invoice),
    'ledger_reversal_status', v_ledger_status,
    'reversal', case when v_reversal_result is not null then v_reversal_result->'reversal' else null end,
    'original_journal', case when v_reversal_result is not null then v_reversal_result->'original' else null end
  );
end;
$$;

revoke all on function void_invoice(uuid, text, uuid) from public;
revoke all on function void_invoice(uuid, text, uuid) from authenticated;
revoke all on function void_invoice(uuid, text, uuid) from anon;
grant execute on function void_invoice(uuid, text, uuid) to service_role;

-- [feature-spec-1.1.C.md §2.2 / §8 decision #7] Scheduled due_date → Overdue transition.
-- Pure status flip on due_date only — does not read or update amount_paid
-- (feature-spec-1_1_D.md §4.1; payment_applications trigger owns that). No ledger interaction.
-- Exception token: COMPANY_ID_REQUIRED
create or replace function mark_overdue_invoices(p_company_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  if p_company_id is null then
    raise exception 'COMPANY_ID_REQUIRED';
  end if;

  -- [feature-spec-1.1.C.md §8 / decision #15] ovd: per-company namespace — same
  -- pattern as qxp:/ob:/ye:/rjt:/quo:/inv:/crn:/cnl: advisory locks.
  perform pg_advisory_xact_lock(hashtext('ovd:' || p_company_id::text));

  update invoices
     set status = 'overdue',
         updated_at = now()
   where company_id = p_company_id
     and status in ('issued', 'sent', 'viewed')
     and due_date is not null
     and due_date < current_date;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function mark_overdue_invoices(uuid) from public;
revoke all on function mark_overdue_invoices(uuid) from authenticated;
revoke all on function mark_overdue_invoices(uuid) from anon;
grant execute on function mark_overdue_invoices(uuid) to service_role;

-- [feature-spec-1.1.C.md §4 decision #9] Accepted quotation → Draft invoice; one-time link.
create or replace function convert_quotation_to_invoice(
  p_quotation_id uuid,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quotation quotations%rowtype;
  v_invoice_id uuid;
  v_line quotation_lines%rowtype;
begin
  if p_created_by is null then
    raise exception 'CREATED_BY_REQUIRED';
  end if;

  select * into v_quotation
    from quotations
   where id = p_quotation_id
     for update;

  if not found then
    raise exception 'QUOTATION_NOT_FOUND';
  end if;

  if v_quotation.status <> 'accepted' then
    raise exception 'QUOTATION_NOT_ACCEPTED';
  end if;

  if v_quotation.converted_to_invoice_id is not null then
    raise exception 'QUOTATION_ALREADY_CONVERTED';
  end if;

  if not exists (select 1 from quotation_lines where quotation_id = p_quotation_id) then
    raise exception 'QUOTATION_REQUIRES_LINES';
  end if;

  insert into invoices (
    company_id,
    customer_id,
    invoice_date,
    payment_terms,
    status,
    source_quotation_id,
    created_by
  ) values (
    v_quotation.company_id,
    v_quotation.customer_id,
    v_quotation.quotation_date,
    'net_30',
    'draft',
    p_quotation_id,
    p_created_by
  )
  returning id into v_invoice_id;

  for v_line in
    select *
      from quotation_lines
     where quotation_id = p_quotation_id
     order by line_number
  loop
    insert into invoice_lines (
      invoice_id,
      line_number,
      description,
      quantity,
      unit_price,
      discount_percent,
      discount_amount,
      vat_rate,
      is_service,
      vat_category,
      emirate
    ) values (
      v_invoice_id,
      v_line.line_number,
      v_line.description,
      v_line.quantity,
      v_line.unit_price,
      v_line.discount_percent,
      v_line.discount_amount,
      v_line.vat_rate,
      v_line.is_service,
      v_line.vat_category,
      v_line.emirate
    );
  end loop;

  update quotations
     set converted_to_invoice_id = v_invoice_id,
         updated_at = now()
   where id = p_quotation_id;

  return v_invoice_id;
end;
$$;

revoke all on function convert_quotation_to_invoice(uuid, uuid) from public;
revoke all on function convert_quotation_to_invoice(uuid, uuid) from authenticated;
revoke all on function convert_quotation_to_invoice(uuid, uuid) from anon;
grant execute on function convert_quotation_to_invoice(uuid, uuid) to service_role;

-- Integration-only: same-transaction trace for invoice recalc trigger depth (not a product API).
create or replace function integration_verify_invoice_recalc_fires_once(
  p_line_id uuid,
  p_quantity numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform set_config('app.invoice_recalc_trace', 'true', true);
  perform set_config('app.invoice_recalc_call_count', '0', true);
  perform set_config('app.invoice_line_trigger_count', '0', true);

  update invoice_lines
     set quantity = p_quantity
   where id = p_line_id;

  return jsonb_build_object(
    'line_trigger_fires', current_setting('app.invoice_line_trigger_count', true)::int,
    'recalc_calls', current_setting('app.invoice_recalc_call_count', true)::int
  );
end;
$$;

-- Integration-only: Issue transition must not fire line→header recalc cascade.
create or replace function integration_verify_invoice_issue_no_recalc(
  p_invoice_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform set_config('app.invoice_recalc_trace', 'true', true);
  perform set_config('app.invoice_recalc_call_count', '0', true);
  perform set_config('app.invoice_line_trigger_count', '0', true);

  perform issue_invoice(p_invoice_id);

  return jsonb_build_object(
    'line_trigger_fires', current_setting('app.invoice_line_trigger_count', true)::int,
    'recalc_calls', current_setting('app.invoice_recalc_call_count', true)::int
  );
end;
$$;

revoke all on function integration_verify_invoice_recalc_fires_once(uuid, numeric) from public;
revoke all on function integration_verify_invoice_recalc_fires_once(uuid, numeric) from authenticated;
revoke all on function integration_verify_invoice_recalc_fires_once(uuid, numeric) from anon;
grant execute on function integration_verify_invoice_recalc_fires_once(uuid, numeric) to service_role;

revoke all on function integration_verify_invoice_issue_no_recalc(uuid) from public;
revoke all on function integration_verify_invoice_issue_no_recalc(uuid) from authenticated;
revoke all on function integration_verify_invoice_issue_no_recalc(uuid) from anon;
grant execute on function integration_verify_invoice_issue_no_recalc(uuid) to service_role;

revoke all on function suggest_invoice_line_income_account() from public;
revoke all on function suggest_invoice_line_income_account() from authenticated;
revoke all on function suggest_invoice_line_income_account() from anon;
grant execute on function suggest_invoice_line_income_account() to service_role;

revoke all on function set_invoice_line_computed_fields() from public;
revoke all on function set_invoice_line_computed_fields() from authenticated;
revoke all on function set_invoice_line_computed_fields() from anon;
grant execute on function set_invoice_line_computed_fields() to service_role;

revoke all on function recalculate_invoice_totals(uuid) from public;
revoke all on function recalculate_invoice_totals(uuid) from authenticated;
revoke all on function recalculate_invoice_totals(uuid) from anon;
grant execute on function recalculate_invoice_totals(uuid) to service_role;

revoke all on function refresh_invoice_totals_from_lines() from public;
revoke all on function refresh_invoice_totals_from_lines() from authenticated;
revoke all on function refresh_invoice_totals_from_lines() from anon;
grant execute on function refresh_invoice_totals_from_lines() to service_role;

revoke all on function prevent_nondraft_invoice_line_mutation() from public;
revoke all on function prevent_nondraft_invoice_line_mutation() from authenticated;
revoke all on function prevent_nondraft_invoice_line_mutation() from anon;
grant execute on function prevent_nondraft_invoice_line_mutation() to service_role;

revoke all on function prevent_invoice_computed_totals_mutation() from public;
revoke all on function prevent_invoice_computed_totals_mutation() from authenticated;
revoke all on function prevent_invoice_computed_totals_mutation() from anon;
grant execute on function prevent_invoice_computed_totals_mutation() to service_role;

revoke all on function prevent_nondraft_invoice_header_mutation() from public;
revoke all on function prevent_nondraft_invoice_header_mutation() from authenticated;
revoke all on function prevent_nondraft_invoice_header_mutation() from anon;
grant execute on function prevent_nondraft_invoice_header_mutation() to service_role;

-- ============================================================================
-- 7d. Module 1.1.C — credit notes (feature-spec-1.1.C.md §1.4, decision #5)
-- ============================================================================

create type credit_note_status as enum ('draft', 'issued', 'void');

create table credit_notes (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  customer_id           uuid not null references customers(id),
  original_invoice_id   uuid not null references invoices(id),
  credit_note_number    text,
  credit_note_date      date not null,
  status                credit_note_status not null default 'draft',
  subtotal              numeric(18,2) not null default 0,
  vat_total             numeric(18,2) not null default 0,
  grand_total           numeric(18,2) not null default 0,
  journal_entry_id      uuid references journal_entries(id),
  void_reason           text,
  created_by            uuid not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint credit_notes_void_reason_required check (
    status <> 'void' or (void_reason is not null and btrim(void_reason) <> '')
  )
);

create unique index credit_notes_company_number_unique
  on credit_notes(company_id, credit_note_number)
  where credit_note_number is not null;

create index idx_credit_notes_company on credit_notes(company_id);
create index idx_credit_notes_original_invoice on credit_notes(original_invoice_id);
create index idx_credit_notes_status on credit_notes(company_id, status);

create table credit_note_lines (
  id                        uuid primary key default gen_random_uuid(),
  credit_note_id            uuid not null references credit_notes(id) on delete cascade,
  line_number               smallint not null,
  description               text not null,
  quantity                  numeric(18,4) not null,
  unit_price                numeric(18,2) not null,
  discount_percent          numeric(5,2),
  discount_amount           numeric(18,2),
  vat_rate                  numeric(5,2) not null,
  is_service                boolean not null default false,
  income_account_id         uuid references accounts(id),
  line_total                numeric(18,2) not null default 0,
  -- [feature-spec-1_1_F.md F-19 / F-43] copied from original invoice line when linked
  vat_category              vat_category,
  emirate                   uae_emirate,
  original_invoice_line_id  uuid references invoice_lines(id),
  reason                    text,
  unique (credit_note_id, line_number),
  constraint credit_note_lines_discount_xor check (
    not (discount_percent is not null and discount_amount is not null)
  ),
  constraint credit_note_lines_reason_required check (
    original_invoice_line_id is not null
    or (reason is not null and btrim(reason) <> '')
  )
);

create index idx_credit_note_lines_credit_note on credit_note_lines(credit_note_id);
create index idx_credit_note_lines_original_invoice_line
  on credit_note_lines(original_invoice_line_id)
  where original_invoice_line_id is not null;

-- [feature-spec-1.1.C.md decision #18] crn: lock; CRN-YYYY-NNNN; Issue only.
create or replace function allocate_next_credit_note_number(
  p_company_id uuid,
  p_credit_note_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year int;
  v_seq  int;
begin
  if p_company_id is null then
    raise exception 'COMPANY_ID_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtext('crn:' || p_company_id::text));

  v_year := extract(year from coalesce(p_credit_note_date, current_date))::int;

  select coalesce(
    max(
      nullif(
        regexp_replace(credit_note_number, '^CRN-' || v_year::text || '-', ''),
        credit_note_number
      )::int
    ),
    0
  ) + 1
    into v_seq
    from credit_notes
   where company_id = p_company_id
     and credit_note_number ~ ('^CRN-' || v_year::text || '-[0-9]+$');

  return format('CRN-%s-%s', v_year, lpad(v_seq::text, 4, '0'));
end;
$$;

revoke all on function allocate_next_credit_note_number(uuid, date) from public;
revoke all on function allocate_next_credit_note_number(uuid, date) from authenticated;
revoke all on function allocate_next_credit_note_number(uuid, date) from anon;
grant execute on function allocate_next_credit_note_number(uuid, date) to service_role;

-- [feature-spec-1.1.C.md §1.4 decision #5] Copy VAT treatment from original line on INSERT;
-- immutable on UPDATE when linked.
create or replace function copy_credit_note_line_from_invoice_line()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_src_vat numeric(5,2);
  v_src_income uuid;
  v_src_is_service boolean;
  v_src_invoice_id uuid;
  v_cn_invoice_id uuid;
  v_src_category vat_category;
  v_src_emirate uae_emirate;
begin
  if new.original_invoice_line_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.original_invoice_line_id is not null then
      if new.vat_rate is distinct from old.vat_rate
         or new.income_account_id is distinct from old.income_account_id
         or new.is_service is distinct from old.is_service
         or new.vat_category is distinct from old.vat_category
         or new.emirate is distinct from old.emirate then
        raise exception 'CREDIT_NOTE_LINE_DERIVED_FIELDS_IMMUTABLE';
      end if;
    end if;
    return new;
  end if;

  select il.vat_rate, il.income_account_id, il.is_service, il.invoice_id,
         il.vat_category, il.emirate
    into v_src_vat, v_src_income, v_src_is_service, v_src_invoice_id,
         v_src_category, v_src_emirate
    from invoice_lines il
   where il.id = new.original_invoice_line_id;

  if not found then
    raise exception 'ORIGINAL_INVOICE_LINE_NOT_FOUND';
  end if;

  select cn.original_invoice_id
    into v_cn_invoice_id
    from credit_notes cn
   where cn.id = new.credit_note_id;

  if v_cn_invoice_id is distinct from v_src_invoice_id then
    raise exception 'ORIGINAL_INVOICE_LINE_MISMATCH';
  end if;

  new.vat_rate := v_src_vat;
  new.income_account_id := v_src_income;
  new.is_service := v_src_is_service;
  new.vat_category := v_src_category;
  new.emirate := v_src_emirate;

  return new;
end;
$$;

create trigger trg_01_copy_credit_note_line_from_invoice
  before insert or update on credit_note_lines
  for each row execute function copy_credit_note_line_from_invoice_line();

create or replace function suggest_credit_note_line_income_account()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_account_number char(4);
  v_account_id uuid;
begin
  if new.original_invoice_line_id is not null or new.income_account_id is not null then
    return new;
  end if;

  select company_id into v_company_id from credit_notes where id = new.credit_note_id;
  if v_company_id is null then
    return new;
  end if;

  -- [feature-spec-1_1_F.md F-19] vat_category wins when set; vat_rate heuristic for legacy drafts.
  if new.vat_category = 'standard_rated' then
    if coalesce(new.is_service, false) then
      v_account_number := '4040';
    else
      v_account_number := '4000';
    end if;
  elsif new.vat_category = 'zero_rated' then
    v_account_number := '4010';
  elsif new.vat_category = 'exempt' then
    v_account_number := '4020';
  elsif new.vat_category = 'designated_zone' then
    v_account_number := '4030';
  elsif new.vat_category = 'out_of_scope' then
    return new;
  elsif new.vat_rate = 5 then
    if coalesce(new.is_service, false) then
      v_account_number := '4040';
    else
      v_account_number := '4000';
    end if;
  elsif new.vat_rate = 0 then
    v_account_number := '4010';
  else
    v_account_number := '4020';
  end if;

  select id into v_account_id
    from accounts
   where company_id = v_company_id
     and account_number = v_account_number
     and (v_account_number <> '4030' or is_active = true)
   limit 1;

  if v_account_id is not null then
    new.income_account_id := v_account_id;
  end if;

  return new;
end;
$$;

create trigger trg_02_suggest_credit_note_line_income_account
  before insert or update on credit_note_lines
  for each row execute function suggest_credit_note_line_income_account();

create or replace function set_credit_note_line_computed_fields()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_net numeric(18,2);
  v_vat numeric(18,2);
  v_total numeric(18,2);
begin
  select * into v_net, v_vat, v_total
    from compute_quotation_line_amounts(
      new.quantity,
      new.unit_price,
      new.discount_percent,
      new.discount_amount,
      new.vat_rate
    );
  new.line_total := v_total;
  return new;
end;
$$;

create trigger trg_03_set_credit_note_line_computed_fields
  before insert or update on credit_note_lines
  for each row execute function set_credit_note_line_computed_fields();

-- [feature-spec-1.1.C.md §1.4 decision #5] Cumulative cap + cnl: advisory lock.
create or replace function enforce_credit_note_line_cumulative_cap()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_original_line_total numeric(18,2);
  v_credited_so_far numeric(18,2);
begin
  if new.original_invoice_line_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('cnl:' || new.original_invoice_line_id::text));

  select il.line_total into v_original_line_total
    from invoice_lines il
   where il.id = new.original_invoice_line_id;

  if not found then
    raise exception 'ORIGINAL_INVOICE_LINE_NOT_FOUND';
  end if;

  select coalesce(sum(cnl.line_total), 0)
    into v_credited_so_far
    from credit_note_lines cnl
    join credit_notes cn on cn.id = cnl.credit_note_id
   where cnl.original_invoice_line_id = new.original_invoice_line_id
     and cn.status <> 'void'
     and (tg_op = 'INSERT' or cnl.id <> new.id);

  if v_credited_so_far + new.line_total > v_original_line_total then
    raise exception 'CREDIT_NOTE_LINE_CUMULATIVE_CAP_EXCEEDED';
  end if;

  return new;
end;
$$;

create trigger trg_04_enforce_credit_note_line_cumulative_cap
  before insert or update on credit_note_lines
  for each row execute function enforce_credit_note_line_cumulative_cap();

create or replace function recalculate_credit_note_totals(p_credit_note_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status credit_note_status;
  v_subtotal numeric(18,2) := 0;
  v_vat_total numeric(18,2) := 0;
  v_line record;
  v_net numeric(18,2);
  v_vat numeric(18,2);
  v_total numeric(18,2);
begin
  select status into v_status from credit_notes where id = p_credit_note_id;

  if not found or v_status <> 'draft' then
    return;
  end if;

  for v_line in
    select quantity, unit_price, discount_percent, discount_amount, vat_rate
      from credit_note_lines
     where credit_note_id = p_credit_note_id
     order by line_number
  loop
    select * into v_net, v_vat, v_total
      from compute_quotation_line_amounts(
        v_line.quantity,
        v_line.unit_price,
        v_line.discount_percent,
        v_line.discount_amount,
        v_line.vat_rate
      );
    v_subtotal := v_subtotal + v_net;
    v_vat_total := v_vat_total + v_vat;
  end loop;

  perform set_config('app.credit_note_recalc_in_progress', 'true', true);

  -- [feature-spec-1.1.C.md §1.4] Diagnostic only: integration tests set
  -- app.credit_note_recalc_trace=true in the same transaction to assert this
  -- function runs exactly once per line mutation (no header→line cascade).
  if current_setting('app.credit_note_recalc_trace', true) = 'true' then
    perform set_config(
      'app.credit_note_recalc_call_count',
      (coalesce(nullif(current_setting('app.credit_note_recalc_call_count', true), ''), '0')::int + 1)::text,
      true
    );
  end if;

  update credit_notes
     set subtotal = v_subtotal,
         vat_total = v_vat_total,
         grand_total = v_subtotal + v_vat_total,
         updated_at = now()
   where id = p_credit_note_id
     and status = 'draft';

  perform set_config('app.credit_note_recalc_in_progress', '', true);
end;
$$;

create or replace function refresh_credit_note_totals_from_lines()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_setting('app.credit_note_recalc_trace', true) = 'true' then
    perform set_config(
      'app.credit_note_line_trigger_count',
      (coalesce(nullif(current_setting('app.credit_note_line_trigger_count', true), ''), '0')::int + 1)::text,
      true
    );
  end if;

  perform recalculate_credit_note_totals(coalesce(new.credit_note_id, old.credit_note_id));
  return coalesce(new, old);
end;
$$;

create trigger trg_refresh_credit_note_totals_from_lines
  after insert or update or delete on credit_note_lines
  for each row execute function refresh_credit_note_totals_from_lines();

create or replace function prevent_nondraft_credit_note_line_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status credit_note_status;
begin
  select status into v_status
    from credit_notes
   where id = coalesce(new.credit_note_id, old.credit_note_id);

  if v_status = 'draft' then
    return coalesce(new, old);
  end if;

  raise exception 'CREDIT_NOTE_LINE_MUTATION_BLOCKED';
end;
$$;

create trigger trg_prevent_nondraft_credit_note_line_mutation
  before insert or update or delete on credit_note_lines
  for each row execute function prevent_nondraft_credit_note_line_mutation();

create or replace function prevent_credit_note_computed_totals_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_setting('app.credit_note_recalc_in_progress', true) = 'true' then
    return new;
  end if;

  if new.subtotal is distinct from old.subtotal
     or new.vat_total is distinct from old.vat_total
     or new.grand_total is distinct from old.grand_total then
    raise exception 'CREDIT_NOTE_TOTALS_CLIENT_MUTATION_BLOCKED';
  end if;

  return new;
end;
$$;

create trigger trg_prevent_credit_note_computed_totals_mutation
  before update on credit_notes
  for each row execute function prevent_credit_note_computed_totals_mutation();

create or replace function prevent_nondraft_credit_note_header_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.status = 'draft' then
    return new;
  end if;

  if new.customer_id is distinct from old.customer_id
     or new.original_invoice_id is distinct from old.original_invoice_id
     or new.credit_note_date is distinct from old.credit_note_date
     or new.credit_note_number is distinct from old.credit_note_number then
    raise exception 'CREDIT_NOTE_HEADER_MUTATION_BLOCKED';
  end if;

  return new;
end;
$$;

create trigger trg_prevent_nondraft_credit_note_header_mutation
  before update on credit_notes
  for each row execute function prevent_nondraft_credit_note_header_mutation();

-- [feature-spec-1.1.C.md §7 decision #14] Atomic credit-note ledger posting at Issue.
-- Mirror of create_invoice_journal_entry — does NOT reuse reverse_journal_entry (partial credits).
-- Exception tokens: CREATED_BY_REQUIRED, CREDIT_NOTE_NOT_FOUND, CREDIT_NOTE_JOURNAL_ALREADY_POSTED,
-- CREDIT_NOTE_REQUIRES_LINES, CREDIT_NOTE_POSTING_ACCOUNT_NOT_FOUND,
-- CREDIT_NOTE_LINE_MISSING_INCOME_ACCOUNT, NO_OPEN_PERIOD_FOR_CREDIT_NOTE_DATE,
-- CREDIT_NOTE_POSTING_UNBALANCED
create or replace function create_credit_note_journal_entry(
  p_credit_note_id uuid,
  p_created_by uuid,
  p_reference_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cn             credit_notes%rowtype;
  v_period         accounting_periods%rowtype;
  v_entry_number   bigint;
  v_entry          journal_entries%rowtype;
  v_lines          jsonb;
  v_line           record;
  v_ar_id          uuid;
  v_discount_id    uuid;
  v_vat_id         uuid;
  v_line_number    int := 0;
  v_gross          numeric(18,2);
  v_discount       numeric(18,2);
  v_gross_sum      numeric(18,2) := 0;
  v_discount_sum   numeric(18,2) := 0;
  v_total_debits   numeric(18,2);
  v_total_credits  numeric(18,2);
  v_ref            text;
begin
  if p_created_by is null then
    raise exception 'CREATED_BY_REQUIRED';
  end if;

  select * into v_cn from credit_notes where id = p_credit_note_id;
  if not found then
    raise exception 'CREDIT_NOTE_NOT_FOUND';
  end if;

  if v_cn.journal_entry_id is not null then
    raise exception 'CREDIT_NOTE_JOURNAL_ALREADY_POSTED';
  end if;

  if not exists (select 1 from credit_note_lines where credit_note_id = p_credit_note_id) then
    raise exception 'CREDIT_NOTE_REQUIRES_LINES';
  end if;

  select id into v_ar_id
    from accounts
   where company_id = v_cn.company_id
     and account_number = '1100';
  if v_ar_id is null then
    raise exception 'CREDIT_NOTE_POSTING_ACCOUNT_NOT_FOUND';
  end if;

  select id into v_discount_id
    from accounts
   where company_id = v_cn.company_id
     and account_number = '4060';
  if v_discount_id is null then
    raise exception 'CREDIT_NOTE_POSTING_ACCOUNT_NOT_FOUND';
  end if;

  select id into v_vat_id
    from accounts
   where company_id = v_cn.company_id
     and account_number = '2200';
  if v_vat_id is null then
    raise exception 'CREDIT_NOTE_POSTING_ACCOUNT_NOT_FOUND';
  end if;

  -- [schema.sql accounting_periods] Half-open [period_start, period_end).
  select * into v_period
    from accounting_periods
   where company_id = v_cn.company_id
     and status = 'open'
     and period_start <= v_cn.credit_note_date
     and period_end > v_cn.credit_note_date
   order by period_start
   limit 1;

  if not found then
    raise exception 'NO_OPEN_PERIOD_FOR_CREDIT_NOTE_DATE';
  end if;

  for v_line in
    select cnl.*
      from credit_note_lines cnl
     where cnl.credit_note_id = p_credit_note_id
     order by cnl.line_number
  loop
    if v_line.income_account_id is null then
      raise exception 'CREDIT_NOTE_LINE_MISSING_INCOME_ACCOUNT';
    end if;

    v_gross := round(v_line.quantity * v_line.unit_price, 2);

    if v_line.discount_percent is not null then
      v_discount := round(v_gross * v_line.discount_percent / 100, 2);
    elsif v_line.discount_amount is not null then
      v_discount := v_line.discount_amount;
    else
      v_discount := 0;
    end if;

    v_gross_sum := v_gross_sum + v_gross;
    v_discount_sum := v_discount_sum + v_discount;
  end loop;

  v_total_debits := v_gross_sum + v_cn.vat_total;
  v_total_credits := v_cn.grand_total + v_discount_sum;

  if v_total_debits <> v_total_credits then
    raise exception 'CREDIT_NOTE_POSTING_UNBALANCED';
  end if;

  v_ref := coalesce(nullif(btrim(p_reference_number), ''), v_cn.credit_note_number);

  v_entry_number := allocate_next_entry_number(v_cn.company_id);

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
    v_cn.company_id,
    v_entry_number,
    v_period.id,
    v_cn.credit_note_date,
    'credit_note',
    'draft',
    case
      when v_ref is not null then 'Credit note ' || v_ref
      else 'Credit note'
    end,
    v_ref,
    p_created_by
  )
  returning * into v_entry;

  v_line_number := v_line_number + 1;
  insert into journal_lines (
    journal_entry_id,
    line_number,
    account_id,
    debit,
    credit,
    description
  ) values (
    v_entry.id,
    v_line_number,
    v_ar_id,
    0,
    v_cn.grand_total,
    'Accounts Receivable - Trade'
  );

  for v_line in
    select cnl.*
      from credit_note_lines cnl
     where cnl.credit_note_id = p_credit_note_id
     order by cnl.line_number
  loop
    v_gross := round(v_line.quantity * v_line.unit_price, 2);
    v_line_number := v_line_number + 1;
    insert into journal_lines (
      journal_entry_id,
      line_number,
      account_id,
      debit,
      credit,
      description
    ) values (
      v_entry.id,
      v_line_number,
      v_line.income_account_id,
      v_gross,
      0,
      v_line.description
    );
  end loop;

  if v_discount_sum > 0 then
    v_line_number := v_line_number + 1;
    insert into journal_lines (
      journal_entry_id,
      line_number,
      account_id,
      debit,
      credit,
      description
    ) values (
      v_entry.id,
      v_line_number,
      v_discount_id,
      0,
      v_discount_sum,
      'Sales Discounts Given'
    );
  end if;

  if v_cn.vat_total > 0 then
    v_line_number := v_line_number + 1;
    insert into journal_lines (
      journal_entry_id,
      line_number,
      account_id,
      debit,
      credit,
      description
    ) values (
      v_entry.id,
      v_line_number,
      v_vat_id,
      v_cn.vat_total,
      0,
      'VAT Payable - Output VAT'
    );
  end if;

  update journal_entries
     set status = 'posted'
   where id = v_entry.id
     and status = 'draft'
  returning * into v_entry;

  if not found then
    raise exception 'Failed to post credit note entry %', v_entry_number;
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

revoke all on function create_credit_note_journal_entry(uuid, uuid, text) from public;
revoke all on function create_credit_note_journal_entry(uuid, uuid, text) from authenticated;
revoke all on function create_credit_note_journal_entry(uuid, uuid, text) from anon;
grant execute on function create_credit_note_journal_entry(uuid, uuid, text) to service_role;

-- [feature-spec-1.1.C.md §1.4 / decision #18 / §7 decision #14] Issue: numbering + ledger posting.
create or replace function issue_credit_note(p_credit_note_id uuid)
returns credit_notes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cn credit_notes%rowtype;
  v_inv_status invoice_status;
  v_number text;
  v_journal_result jsonb;
  v_journal_entry_id uuid;
begin
  select * into v_cn from credit_notes where id = p_credit_note_id for update;
  if not found then
    raise exception 'CREDIT_NOTE_NOT_FOUND';
  end if;

  if v_cn.status <> 'draft' then
    raise exception 'CREDIT_NOTE_NOT_DRAFT';
  end if;

  if not exists (select 1 from credit_note_lines where credit_note_id = p_credit_note_id) then
    raise exception 'CREDIT_NOTE_REQUIRES_LINES';
  end if;

  -- [feature-spec-1_1_F.md F-19 / F-38 / F-43]
  perform assert_credit_note_vat_ready(p_credit_note_id);
  perform assert_not_filed_vat_period(
    v_cn.company_id, v_cn.credit_note_date, false, true
  );

  select status into v_inv_status from invoices where id = v_cn.original_invoice_id;
  if v_inv_status is null or v_inv_status = 'draft' then
    raise exception 'CREDIT_NOTE_ORIGINAL_INVOICE_NOT_ISSUED';
  end if;
  if v_inv_status = 'void' then
    raise exception 'CREDIT_NOTE_ORIGINAL_INVOICE_VOID';
  end if;

  v_number := allocate_next_credit_note_number(v_cn.company_id, v_cn.credit_note_date);

  v_journal_result := create_credit_note_journal_entry(
    p_credit_note_id,
    v_cn.created_by,
    v_number
  );
  v_journal_entry_id := (v_journal_result->>'journal_entry_id')::uuid;

  update credit_notes
     set status = 'issued',
         credit_note_number = v_number,
         journal_entry_id = v_journal_entry_id,
         updated_at = now()
   where id = p_credit_note_id
  returning * into v_cn;

  return v_cn;
end;
$$;

revoke all on function issue_credit_note(uuid) from public;
revoke all on function issue_credit_note(uuid) from authenticated;
revoke all on function issue_credit_note(uuid) from anon;
grant execute on function issue_credit_note(uuid) to service_role;

-- [feature-spec-1.1.C.md §2.2 / §7 / decision #14 clarified] Void credit note +
-- optional ledger reversal in one transaction. reverse_journal_entry is correct
-- here: void is all-or-nothing on the whole document (unlike partial Issue posting).
-- Exception tokens: CREATED_BY_REQUIRED, VOID_REASON_REQUIRED, CREDIT_NOTE_NOT_FOUND,
-- CREDIT_NOTE_VOID_NOT_PERMITTED
create or replace function void_credit_note(
  p_credit_note_id uuid,
  p_void_reason text,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cn               credit_notes%rowtype;
  v_reversal_result  jsonb;
  v_ledger_status    text;
begin
  if p_created_by is null then
    raise exception 'CREATED_BY_REQUIRED';
  end if;

  if p_void_reason is null or btrim(p_void_reason) = '' then
    raise exception 'VOID_REASON_REQUIRED';
  end if;

  select * into v_cn from credit_notes where id = p_credit_note_id for update;
  if not found then
    raise exception 'CREDIT_NOTE_NOT_FOUND';
  end if;

  if v_cn.status <> 'issued' then
    raise exception 'CREDIT_NOTE_VOID_NOT_PERMITTED';
  end if;

  -- [feature-spec-1_1_F.md F-38]
  perform assert_not_filed_vat_period(
    v_cn.company_id, v_cn.credit_note_date, false, true
  );

  if v_cn.journal_entry_id is not null then
    v_reversal_result := reverse_journal_entry(v_cn.journal_entry_id, p_created_by);
    v_ledger_status := 'reversed';
  else
    v_reversal_result := null;
    v_ledger_status := 'skipped_no_posting';
  end if;

  update credit_notes
     set status = 'void',
         void_reason = btrim(p_void_reason),
         updated_at = now()
   where id = p_credit_note_id
  returning * into v_cn;

  return jsonb_build_object(
    'credit_note', to_jsonb(v_cn),
    'ledger_reversal_status', v_ledger_status,
    'reversal', case when v_reversal_result is not null then v_reversal_result->'reversal' else null end,
    'original_journal', case when v_reversal_result is not null then v_reversal_result->'original' else null end
  );
end;
$$;

revoke all on function void_credit_note(uuid, text, uuid) from public;
revoke all on function void_credit_note(uuid, text, uuid) from authenticated;
revoke all on function void_credit_note(uuid, text, uuid) from anon;
grant execute on function void_credit_note(uuid, text, uuid) to service_role;

-- Integration-only: same-transaction trace for credit note recalc trigger depth (not a product API).
create or replace function integration_verify_credit_note_recalc_fires_once(
  p_line_id uuid,
  p_quantity numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform set_config('app.credit_note_recalc_trace', 'true', true);
  perform set_config('app.credit_note_recalc_call_count', '0', true);
  perform set_config('app.credit_note_line_trigger_count', '0', true);

  update credit_note_lines
     set quantity = p_quantity
   where id = p_line_id;

  return jsonb_build_object(
    'line_trigger_fires', current_setting('app.credit_note_line_trigger_count', true)::int,
    'recalc_calls', current_setting('app.credit_note_recalc_call_count', true)::int
  );
end;
$$;

-- Integration-only: Issue transition must not fire line→header recalc cascade.
create or replace function integration_verify_credit_note_issue_no_recalc(
  p_credit_note_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform set_config('app.credit_note_recalc_trace', 'true', true);
  perform set_config('app.credit_note_recalc_call_count', '0', true);
  perform set_config('app.credit_note_line_trigger_count', '0', true);

  perform issue_credit_note(p_credit_note_id);

  return jsonb_build_object(
    'line_trigger_fires', current_setting('app.credit_note_line_trigger_count', true)::int,
    'recalc_calls', current_setting('app.credit_note_recalc_call_count', true)::int
  );
end;
$$;

revoke all on function integration_verify_credit_note_recalc_fires_once(uuid, numeric) from public;
revoke all on function integration_verify_credit_note_recalc_fires_once(uuid, numeric) from authenticated;
revoke all on function integration_verify_credit_note_recalc_fires_once(uuid, numeric) from anon;
grant execute on function integration_verify_credit_note_recalc_fires_once(uuid, numeric) to service_role;

revoke all on function integration_verify_credit_note_issue_no_recalc(uuid) from public;
revoke all on function integration_verify_credit_note_issue_no_recalc(uuid) from authenticated;
revoke all on function integration_verify_credit_note_issue_no_recalc(uuid) from anon;
grant execute on function integration_verify_credit_note_issue_no_recalc(uuid) to service_role;

revoke all on function copy_credit_note_line_from_invoice_line() from public;
revoke all on function copy_credit_note_line_from_invoice_line() from authenticated;
revoke all on function copy_credit_note_line_from_invoice_line() from anon;
grant execute on function copy_credit_note_line_from_invoice_line() to service_role;

revoke all on function suggest_credit_note_line_income_account() from public;
revoke all on function suggest_credit_note_line_income_account() from authenticated;
revoke all on function suggest_credit_note_line_income_account() from anon;
grant execute on function suggest_credit_note_line_income_account() to service_role;

revoke all on function set_credit_note_line_computed_fields() from public;
revoke all on function set_credit_note_line_computed_fields() from authenticated;
revoke all on function set_credit_note_line_computed_fields() from anon;
grant execute on function set_credit_note_line_computed_fields() to service_role;

revoke all on function enforce_credit_note_line_cumulative_cap() from public;
revoke all on function enforce_credit_note_line_cumulative_cap() from authenticated;
revoke all on function enforce_credit_note_line_cumulative_cap() from anon;
grant execute on function enforce_credit_note_line_cumulative_cap() to service_role;

revoke all on function recalculate_credit_note_totals(uuid) from public;
revoke all on function recalculate_credit_note_totals(uuid) from authenticated;
revoke all on function recalculate_credit_note_totals(uuid) from anon;
grant execute on function recalculate_credit_note_totals(uuid) to service_role;

revoke all on function refresh_credit_note_totals_from_lines() from public;
revoke all on function refresh_credit_note_totals_from_lines() from authenticated;
revoke all on function refresh_credit_note_totals_from_lines() from anon;
grant execute on function refresh_credit_note_totals_from_lines() to service_role;

revoke all on function prevent_nondraft_credit_note_line_mutation() from public;
revoke all on function prevent_nondraft_credit_note_line_mutation() from authenticated;
revoke all on function prevent_nondraft_credit_note_line_mutation() from anon;
grant execute on function prevent_nondraft_credit_note_line_mutation() to service_role;

revoke all on function prevent_credit_note_computed_totals_mutation() from public;
revoke all on function prevent_credit_note_computed_totals_mutation() from authenticated;
revoke all on function prevent_credit_note_computed_totals_mutation() from anon;
grant execute on function prevent_credit_note_computed_totals_mutation() to service_role;

revoke all on function prevent_nondraft_credit_note_header_mutation() from public;
revoke all on function prevent_nondraft_credit_note_header_mutation() from authenticated;
revoke all on function prevent_nondraft_credit_note_header_mutation() from anon;
grant execute on function prevent_nondraft_credit_note_header_mutation() to service_role;

-- [feature-spec.md decision #48 / §7.16 finding #7] §5.1 EXECUTE-revoke checklist
-- on trigger helpers (hygiene — not PostgREST RPCs; triggers fire via engine).
-- Empirical proof: scripts/trigger-execute-empirical-test.mjs (PGlite).

revoke all on function enforce_account_number_category() from public;
revoke all on function enforce_account_number_category() from authenticated;
revoke all on function enforce_account_number_category() from anon;
grant execute on function enforce_account_number_category() to service_role;

revoke all on function enforce_account_hierarchy_depth() from public;
revoke all on function enforce_account_hierarchy_depth() from authenticated;
revoke all on function enforce_account_hierarchy_depth() from anon;
grant execute on function enforce_account_hierarchy_depth() to service_role;

revoke all on function prevent_account_deletion() from public;
revoke all on function prevent_account_deletion() from authenticated;
revoke all on function prevent_account_deletion() from anon;
grant execute on function prevent_account_deletion() to service_role;

revoke all on function prevent_system_account_mutation() from public;
revoke all on function prevent_system_account_mutation() from authenticated;
revoke all on function prevent_system_account_mutation() from anon;
grant execute on function prevent_system_account_mutation() to service_role;

revoke all on function enforce_journal_balance_on_post() from public;
revoke all on function enforce_journal_balance_on_post() from authenticated;
revoke all on function enforce_journal_balance_on_post() from anon;
grant execute on function enforce_journal_balance_on_post() to service_role;

revoke all on function prevent_posted_line_mutation() from public;
revoke all on function prevent_posted_line_mutation() from authenticated;
revoke all on function prevent_posted_line_mutation() from anon;
grant execute on function prevent_posted_line_mutation() to service_role;

revoke all on function prevent_posted_entry_deletion() from public;
revoke all on function prevent_posted_entry_deletion() from authenticated;
revoke all on function prevent_posted_entry_deletion() from anon;
grant execute on function prevent_posted_entry_deletion() to service_role;

revoke all on function prevent_nondraft_header_mutation() from public;
revoke all on function prevent_nondraft_header_mutation() from authenticated;
revoke all on function prevent_nondraft_header_mutation() from anon;
grant execute on function prevent_nondraft_header_mutation() to service_role;

revoke all on function block_audit_log_mutation() from public;
revoke all on function block_audit_log_mutation() from authenticated;
revoke all on function block_audit_log_mutation() from anon;
grant execute on function block_audit_log_mutation() to service_role;

revoke all on function log_journal_entry_change() from public;
revoke all on function log_journal_entry_change() from authenticated;
revoke all on function log_journal_entry_change() from anon;
grant execute on function log_journal_entry_change() to service_role;

-- ============================================================================
-- 7e. Module 1.1.D — AR payments, write-offs, ECL
--     (feature-spec-1_1_D.md §3.2, §3.3, §3.4, §3.4a, §3.4c, §3.7)
-- Advisory-lock namespaces (hashtext('<ns>:' || id)):
--   pay:  — serialise payment_applications against one payment (unapplied_amount)
--   wof:  — serialise create_invoice_write_off against one invoice (§4.4)
--   ecl:  — monthly ECL provisioning run (acquire_ecl_provision_lock)
--   vrl:  — mark_vat_relief_eligible per company (§4.5b)
-- ============================================================================

create table payments (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id),
  customer_id        uuid not null references customers(id),
  payment_date       date not null,
  amount             numeric(18,2) not null check (amount > 0),
  payment_method     payment_method_type,              -- D-12; nullable until set at receipt
  reference_number   text,
  bank_account_id    uuid references accounts(id),     -- D-6 override; else company default
  unapplied_amount   numeric(18,2) not null,           -- starts = amount; trigger-maintained
  journal_entry_id   uuid references journal_entries(id),
  created_by         uuid not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint payments_unapplied_within_amount check (
    unapplied_amount >= 0 and unapplied_amount <= amount
  )
);

create index idx_payments_company on payments(company_id);
create index idx_payments_customer on payments(customer_id);
create index idx_payments_date on payments(company_id, payment_date);
create index idx_payments_journal_entry on payments(journal_entry_id)
  where journal_entry_id is not null;

-- [feature-spec-1_1_D.md §3.2] New payment always starts fully unapplied.
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

create trigger trg_set_payment_unapplied_on_insert
  before insert on payments
  for each row execute function set_payment_unapplied_on_insert();

create table payment_applications (
  id              uuid primary key default gen_random_uuid(),
  payment_id      uuid not null references payments(id) on delete cascade,
  invoice_id      uuid not null references invoices(id),
  applied_amount  numeric(18,2) not null check (applied_amount > 0),
  applied_at      timestamptz not null default now(),
  applied_by      uuid not null
);

create index idx_payment_applications_payment on payment_applications(payment_id);
create index idx_payment_applications_invoice on payment_applications(invoice_id);

-- [feature-spec-1_1_D.md §3.3] Recompute unapplied_amount from applications;
-- CHECK on payments rejects sum(applied) > amount (DB defence-in-depth).
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

  -- [feature-spec-1_1_D.md §3.7] pay: lock — concurrent applications on one payment
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

-- Spec §3.3: insert/delete. UPDATE of applied_amount also recomputed so a
-- direct UPDATE cannot bypass the cap.
create trigger trg_refresh_payment_unapplied_amount
  after insert or update or delete on payment_applications
  for each row execute function refresh_payment_unapplied_amount();

-- [feature-spec-1_1_D.md §4.1 / D-3 / §4.3]
-- amount_paid increments only from payment_applications (never client-set).
-- For advances, the application row (paired with advance_application JE) is
-- what moves amount_paid — not the original advance_receipt.
-- Over-application past grand_total is rejected; excess stays on the payment
-- as unapplied_amount for a different invoice.
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

create trigger trg_refresh_invoice_amount_paid_from_applications
  after insert or update or delete on payment_applications
  for each row execute function refresh_invoice_amount_paid_from_applications();

-- [feature-spec-1_1_D.md §3.4] NO approved_by — approval lives on journal_entries (D-8).
create table write_offs (
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

create index idx_write_offs_company on write_offs(company_id);
create index idx_write_offs_customer on write_offs(customer_id);
create index idx_write_offs_invoice on write_offs(invoice_id);
create index idx_write_offs_vat_relief on write_offs(company_id, vat_relief_eligible)
  where vat_relief_eligible = false;

-- [feature-spec-1_1_D.md §3.4a] Append-only loss-rate policies (versioned by effective_from).
create table ecl_loss_rate_policies (
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

create index idx_ecl_loss_rate_policies_company
  on ecl_loss_rate_policies(company_id, bucket, effective_from desc);

-- [feature-spec-1_1_D.md §3.4c] One ECL provision run per company per period_end.
create table ecl_provision_runs (
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

create index idx_ecl_provision_runs_company on ecl_provision_runs(company_id);

-- [feature-spec-1_1_D.md §3.7 / §4.5a] ecl: lock — concurrent month-end provision runs.
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

revoke all on function set_payment_unapplied_on_insert() from public;
revoke all on function set_payment_unapplied_on_insert() from authenticated;
revoke all on function set_payment_unapplied_on_insert() from anon;
grant execute on function set_payment_unapplied_on_insert() to service_role;

revoke all on function refresh_payment_unapplied_amount() from public;
revoke all on function refresh_payment_unapplied_amount() from authenticated;
revoke all on function refresh_payment_unapplied_amount() from anon;
grant execute on function refresh_payment_unapplied_amount() to service_role;

revoke all on function refresh_invoice_amount_paid_from_applications() from public;
revoke all on function refresh_invoice_amount_paid_from_applications() from authenticated;
revoke all on function refresh_invoice_amount_paid_from_applications() from anon;
grant execute on function refresh_invoice_amount_paid_from_applications() to service_role;

revoke all on function acquire_ecl_provision_lock(uuid) from public;
revoke all on function acquire_ecl_provision_lock(uuid) from authenticated;
revoke all on function acquire_ecl_provision_lock(uuid) from anon;
grant execute on function acquire_ecl_provision_lock(uuid) to service_role;

-- ============================================================================
-- 7f. Module 1.1.D — business-day helper (feature-spec-1_1_D.md §4.5a / D-10, D-14)
-- period_end + N business days for ECL scheduling; weekends via
-- company_settings.weekend_days (ISO isodow); holidays via public_holidays
-- (PROVISIONAL ≡ CONFIRMED per D-14). Company-scoped holiday row wins over
-- UAE-wide for the same date (§3.1b) — both statuses block the day.
-- ============================================================================

-- [feature-spec-1_1_D.md §3.1b / §4.5a] True when p_date is a working day for
-- the company (not weekend, not an applicable public holiday).
create or replace function is_business_day(
  p_company_id uuid,
  p_date date
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_weekend smallint[];
  v_isodow smallint;
  v_has_company_holiday boolean;
  v_has_uae_holiday boolean;
begin
  if p_company_id is null or p_date is null then
    raise exception 'COMPANY_ID_AND_DATE_REQUIRED';
  end if;

  select weekend_days into v_weekend
    from company_settings
   where company_id = p_company_id;

  if not found then
    raise exception 'COMPANY_SETTINGS_NOT_FOUND';
  end if;

  v_isodow := extract(isodow from p_date)::smallint;
  if v_isodow = any (v_weekend) then
    return false;
  end if;

  -- §3.1b resolution: company-scoped row for the date takes precedence.
  -- If present → holiday (block). Else fall back to UAE-wide (company_id null).
  -- D-14: PROVISIONAL and CONFIRMED both count as non-business days.
  select exists (
    select 1 from public_holidays
     where holiday_date = p_date
       and company_id = p_company_id
  ) into v_has_company_holiday;

  if v_has_company_holiday then
    return false;
  end if;

  select exists (
    select 1 from public_holidays
     where holiday_date = p_date
       and company_id is null
  ) into v_has_uae_holiday;

  if v_has_uae_holiday then
    return false;
  end if;

  return true;
end;
$$;

-- [feature-spec-1_1_D.md §4.5a / D-10] Return the date N business days after
-- p_start_date (p_start_date itself is not counted). Always lands on a
-- business day; n <= 0 returns p_start_date unchanged.
create or replace function add_business_days(
  p_company_id uuid,
  p_start_date date,
  p_n integer
)
returns date
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_current date;
  v_remaining integer;
begin
  if p_company_id is null or p_start_date is null then
    raise exception 'COMPANY_ID_AND_DATE_REQUIRED';
  end if;
  if p_n is null then
    raise exception 'N_REQUIRED';
  end if;

  if p_n <= 0 then
    return p_start_date;
  end if;

  v_current := p_start_date;
  v_remaining := p_n;

  while v_remaining > 0 loop
    v_current := v_current + 1;
    if is_business_day(p_company_id, v_current) then
      v_remaining := v_remaining - 1;
    end if;
  end loop;

  return v_current;
end;
$$;

revoke all on function is_business_day(uuid, date) from public;
revoke all on function is_business_day(uuid, date) from authenticated;
revoke all on function is_business_day(uuid, date) from anon;
grant execute on function is_business_day(uuid, date) to service_role;

revoke all on function add_business_days(uuid, date, integer) from public;
revoke all on function add_business_days(uuid, date, integer) from authenticated;
revoke all on function add_business_days(uuid, date, integer) from anon;
grant execute on function add_business_days(uuid, date, integer) to service_role;

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

-- [feature-spec-1_1_D.md §4.4 / D-8 / D-9]
-- Write off remaining unpaid balance: Dr 1110 (and Dr 5640 for shortfall), Cr 1100.
-- Creates draft write_off JE + write_offs row + sets invoices.status = written_off.
-- Nest posts the draft via A's threshold path (D-11: write_off_approval_threshold).
-- Undo: reverse_journal_entry on the JE — no bespoke undo.
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

-- ============================================================================
-- 7e. MODULE 1.1.E — Accounts Payable (feature-spec-1_1_E.md E-1…E-28)
-- Bill entity Option A (`bills` table). GL: 2000 / 1400 / 1350 / 5060 / 2020.
-- ============================================================================

create type bill_status as enum (
  'draft', 'matched', 'pending_approval', 'issued',
  'partially_paid', 'paid', 'disputed', 'void'
);
create type bill_match_status as enum (
  'no_po', 'awaiting_receipt', 'quantity_mismatch', 'price_mismatch',
  'quantity_and_price_mismatch', 'matched'
);
create type po_status as enum (
  'open', 'partially_received', 'received', 'closed', 'cancelled'
);
create type payment_run_status as enum (
  'draft', 'approved', 'executed', 'cancelled'
);

create table suppliers (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references companies(id) on delete cascade,
  supplier_name           text not null,
  trn                     text,
  email                   text,
  phone                   text,
  billing_address         text,
  default_payment_terms   payment_terms_type not null default 'net_30',
  custom_days             int,
  bank_name               text,
  iban                    text,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint suppliers_custom_days_required check (
    default_payment_terms <> 'custom'
    or (custom_days is not null and custom_days > 0)
  )
);
create unique index suppliers_company_trn_unique
  on suppliers(company_id, trn) where trn is not null;
create index idx_suppliers_company on suppliers(company_id);

create table purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  supplier_id   uuid not null references suppliers(id),
  po_number     text not null,
  po_date       date not null,
  status        po_status not null default 'open',
  created_by    uuid not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, po_number)
);
create index idx_purchase_orders_company on purchase_orders(company_id);

create table purchase_order_lines (
  id            uuid primary key default gen_random_uuid(),
  po_id         uuid not null references purchase_orders(id) on delete cascade,
  line_number   smallint not null,
  description   text not null,
  quantity      numeric(18,4) not null check (quantity > 0),
  unit_price    numeric(18,2) not null check (unit_price >= 0),
  account_id    uuid not null references accounts(id),
  line_total    numeric(18,2) not null default 0,
  unique (po_id, line_number)
);

create table goods_receipts (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id),
  supplier_id         uuid not null references suppliers(id),
  purchase_order_id   uuid not null references purchase_orders(id),
  receipt_number      text not null,
  receipt_date        date not null,
  created_by          uuid not null,
  created_at          timestamptz not null default now(),
  unique (company_id, receipt_number)
);
create index idx_goods_receipts_po on goods_receipts(purchase_order_id);

create table goods_receipt_lines (
  id                      uuid primary key default gen_random_uuid(),
  goods_receipt_id        uuid not null references goods_receipts(id) on delete cascade,
  purchase_order_line_id  uuid not null references purchase_order_lines(id),
  quantity_received       numeric(18,4) not null check (quantity_received > 0)
);

create table bills (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references companies(id),
  supplier_id             uuid not null references suppliers(id),
  bill_number             text,
  supplier_invoice_number text,
  purchase_order_id       uuid references purchase_orders(id),
  bill_date               date not null,
  due_date                date,
  payment_terms           payment_terms_type not null default 'net_30',
  custom_days             int,
  subtotal                numeric(18,2) not null default 0,
  vat_total               numeric(18,2) not null default 0,
  grand_total             numeric(18,2) not null default 0,
  amount_paid             numeric(18,2) not null default 0,
  paid_at                 timestamptz,
  status                  bill_status not null default 'draft',
  match_status            bill_match_status,
  possible_duplicate_of   uuid references bills(id),
  scheduled_payment_date  date,
  journal_entry_id        uuid references journal_entries(id),
  payment_match_override_reason  text,
  payment_match_overridden_by    uuid,
  payment_match_overridden_at    timestamptz,
  void_reason             text,
  created_by              uuid not null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (amount_paid >= 0 and amount_paid <= grand_total),
  check (payment_terms <> 'custom' or (custom_days is not null and custom_days > 0)),
  check (status <> 'void' or (void_reason is not null and btrim(void_reason) <> '')),
  check (
    (payment_match_override_reason is null
     and payment_match_overridden_by is null
     and payment_match_overridden_at is null)
    or (
      payment_match_override_reason is not null
      and btrim(payment_match_override_reason) <> ''
      and payment_match_overridden_by is not null
      and payment_match_overridden_at is not null
    )
  )
);
create unique index bills_company_number_unique
  on bills(company_id, bill_number) where bill_number is not null;
create index idx_bills_company on bills(company_id);
create index idx_bills_supplier on bills(supplier_id);
create index idx_bills_status on bills(company_id, status);

create table bill_lines (
  id                      uuid primary key default gen_random_uuid(),
  bill_id                 uuid not null references bills(id) on delete cascade,
  line_number             smallint not null,
  purchase_order_line_id  uuid references purchase_order_lines(id),
  description             text not null,
  quantity                numeric(18,4) not null check (quantity > 0),
  unit_price              numeric(18,2) not null check (unit_price >= 0),
  discount_percent        numeric(5,2),
  discount_amount         numeric(18,2),
  vat_rate                numeric(5,2) not null check (vat_rate >= 0 and vat_rate <= 100),
  account_id              uuid references accounts(id),
  line_total              numeric(18,2) not null default 0,
  -- [feature-spec-1_1_F.md F-19 / F-25 / F-40] nullable until Issue
  vat_category            vat_category,
  vat_input_treatment     vat_input_treatment,
  capital_goods_project_id uuid,
  unique (bill_id, line_number),
  constraint bill_lines_discount_xor check (
    not (discount_percent is not null and discount_amount is not null)
  )
);

create table three_way_match_results (
  id                  uuid primary key default gen_random_uuid(),
  bill_id             uuid not null references bills(id),
  purchase_order_id   uuid references purchase_orders(id),
  goods_receipt_id    uuid references goods_receipts(id),
  match_status        bill_match_status not null,
  details             jsonb,
  checked_at          timestamptz not null default now()
);

create table supplier_payment_runs (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id),
  run_date          date not null,
  payment_method    payment_method_type not null,
  bank_account_id   uuid references accounts(id),
  status            payment_run_status not null default 'draft',
  created_by        uuid not null,
  approved_by       uuid,
  executed_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table supplier_payment_run_items (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references supplier_payment_runs(id) on delete cascade,
  bill_id       uuid not null references bills(id),
  supplier_id   uuid not null references suppliers(id),
  amount_to_pay numeric(18,2) not null check (amount_to_pay > 0),
  included      boolean not null default true,
  unique (run_id, bill_id)
);

create table supplier_payments (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id),
  supplier_id       uuid not null references suppliers(id),
  payment_date      date not null,
  amount            numeric(18,2) not null check (amount > 0),
  payment_method    payment_method_type,
  reference_number  text,
  bank_account_id   uuid references accounts(id),
  unapplied_amount  numeric(18,2) not null,
  journal_entry_id  uuid references journal_entries(id),
  payment_run_id    uuid references supplier_payment_runs(id),
  created_by        uuid not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (unapplied_amount >= 0 and unapplied_amount <= amount)
);
create index idx_supplier_payments_company on supplier_payments(company_id);

create table supplier_payment_applications (
  id                   uuid primary key default gen_random_uuid(),
  supplier_payment_id  uuid not null references supplier_payments(id) on delete cascade,
  bill_id              uuid not null references bills(id),
  applied_amount       numeric(18,2) not null check (applied_amount > 0),
  applied_at           timestamptz not null default now(),
  applied_by           uuid not null,
  journal_entry_id     uuid references journal_entries(id)
);

create table supplier_statement_lines (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  supplier_id           uuid not null references suppliers(id),
  statement_date        date not null,
  line_date             date not null,
  line_type             text not null,
  reference             text,
  amount                numeric(18,2) not null,
  source                text not null default 'manual',
  matched_bill_id       uuid references bills(id),
  matched_payment_id    uuid references supplier_payments(id),
  match_status          text not null default 'unmatched',
  created_at            timestamptz not null default now(),
  check (
    match_status <> 'matched'
    or matched_bill_id is not null
    or matched_payment_id is not null
  )
);

create table grni_accrual_runs (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id),
  period_end_date    date not null,
  accrual_amount     numeric(18,2) not null,
  journal_entry_id   uuid references journal_entries(id),
  reversal_entry_id  uuid references journal_entries(id),
  created_by         uuid not null,
  created_at         timestamptz not null default now(),
  unique (company_id, period_end_date)
);

-- Numbering [E-16]
create or replace function allocate_next_bill_number(
  p_company_id uuid,
  p_bill_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year int;
  v_seq int;
begin
  if p_company_id is null then
    raise exception 'COMPANY_ID_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtext('bil:' || p_company_id::text));
  v_year := extract(year from coalesce(p_bill_date, current_date))::int;
  select coalesce(max(nullif(regexp_replace(bill_number, '^BILL-' || v_year::text || '-', ''), bill_number)::int), 0) + 1
    into v_seq
    from bills
   where company_id = p_company_id
     and bill_number ~ ('^BILL-' || v_year::text || '-[0-9]+$');
  return format('BILL-%s-%s', v_year, lpad(v_seq::text, 4, '0'));
end;
$$;
revoke all on function allocate_next_bill_number(uuid, date) from public;
revoke all on function allocate_next_bill_number(uuid, date) from authenticated;
revoke all on function allocate_next_bill_number(uuid, date) from anon;
grant execute on function allocate_next_bill_number(uuid, date) to service_role;

create or replace function allocate_next_po_number(
  p_company_id uuid,
  p_po_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year int;
  v_seq int;
begin
  if p_company_id is null then
    raise exception 'COMPANY_ID_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtext('po:' || p_company_id::text));
  v_year := extract(year from coalesce(p_po_date, current_date))::int;
  select coalesce(max(nullif(regexp_replace(po_number, '^PO-' || v_year::text || '-', ''), po_number)::int), 0) + 1
    into v_seq
    from purchase_orders
   where company_id = p_company_id
     and po_number ~ ('^PO-' || v_year::text || '-[0-9]+$');
  return format('PO-%s-%s', v_year, lpad(v_seq::text, 4, '0'));
end;
$$;
revoke all on function allocate_next_po_number(uuid, date) from public;
revoke all on function allocate_next_po_number(uuid, date) from authenticated;
revoke all on function allocate_next_po_number(uuid, date) from anon;
grant execute on function allocate_next_po_number(uuid, date) to service_role;

create or replace function allocate_next_grn_number(
  p_company_id uuid,
  p_receipt_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year int;
  v_seq int;
begin
  if p_company_id is null then
    raise exception 'COMPANY_ID_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtext('grn:' || p_company_id::text));
  v_year := extract(year from coalesce(p_receipt_date, current_date))::int;
  select coalesce(max(nullif(regexp_replace(receipt_number, '^GRN-' || v_year::text || '-', ''), receipt_number)::int), 0) + 1
    into v_seq
    from goods_receipts
   where company_id = p_company_id
     and receipt_number ~ ('^GRN-' || v_year::text || '-[0-9]+$');
  return format('GRN-%s-%s', v_year, lpad(v_seq::text, 4, '0'));
end;
$$;
revoke all on function allocate_next_grn_number(uuid, date) from public;
revoke all on function allocate_next_grn_number(uuid, date) from authenticated;
revoke all on function allocate_next_grn_number(uuid, date) from anon;
grant execute on function allocate_next_grn_number(uuid, date) to service_role;

create or replace function assign_po_number()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.po_number is null or btrim(new.po_number) = '' then
    new.po_number := allocate_next_po_number(new.company_id, new.po_date);
  end if;
  return new;
end;
$$;
create trigger trg_assign_po_number
  before insert on purchase_orders
  for each row execute function assign_po_number();

create or replace function assign_grn_number()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.receipt_number is null or btrim(new.receipt_number) = '' then
    new.receipt_number := allocate_next_grn_number(new.company_id, new.receipt_date);
  end if;
  return new;
end;
$$;
create trigger trg_assign_grn_number
  before insert on goods_receipts
  for each row execute function assign_grn_number();

create or replace function set_po_line_total()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.line_total := round(new.quantity * new.unit_price, 2);
  return new;
end;
$$;
create trigger trg_set_po_line_total
  before insert or update on purchase_order_lines
  for each row execute function set_po_line_total();

create or replace function refresh_po_receipt_status()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_po_id uuid;
  v_status po_status;
  v_ordered numeric;
  v_received numeric;
begin
  if tg_table_name = 'goods_receipts' then
    v_po_id := coalesce(new.purchase_order_id, old.purchase_order_id);
  else
    select purchase_order_id into v_po_id
      from goods_receipts
     where id = coalesce(new.goods_receipt_id, old.goods_receipt_id);
  end if;
  if v_po_id is null then
    return coalesce(new, old);
  end if;
  select status into v_status from purchase_orders where id = v_po_id;
  if v_status in ('cancelled', 'closed') then
    return coalesce(new, old);
  end if;
  select coalesce(sum(quantity), 0) into v_ordered from purchase_order_lines where po_id = v_po_id;
  select coalesce(sum(grl.quantity_received), 0) into v_received
    from goods_receipt_lines grl
    join goods_receipts gr on gr.id = grl.goods_receipt_id
   where gr.purchase_order_id = v_po_id;
  update purchase_orders
     set status = case
           when v_received <= 0 then 'open'::po_status
           when v_received < v_ordered then 'partially_received'::po_status
           else 'received'::po_status
         end,
         updated_at = now()
   where id = v_po_id
     and status not in ('cancelled', 'closed');
  return coalesce(new, old);
end;
$$;
create trigger trg_refresh_po_status_on_gr
  after insert or update or delete on goods_receipts
  for each row execute function refresh_po_receipt_status();
create trigger trg_refresh_po_status_on_gr_line
  after insert or update or delete on goods_receipt_lines
  for each row execute function refresh_po_receipt_status();

create or replace function set_bill_line_computed_fields()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_net numeric(18,2);
  v_vat numeric(18,2);
  v_total numeric(18,2);
begin
  select * into v_net, v_vat, v_total
    from compute_quotation_line_amounts(
      new.quantity, new.unit_price, new.discount_percent, new.discount_amount, new.vat_rate
    );
  new.line_total := v_total;
  return new;
end;
$$;
create trigger trg_set_bill_line_computed_fields
  before insert or update on bill_lines
  for each row execute function set_bill_line_computed_fields();

create or replace function recalculate_bill_totals(p_bill_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status bill_status;
  v_subtotal numeric(18,2) := 0;
  v_vat_total numeric(18,2) := 0;
  v_line record;
  v_net numeric(18,2);
  v_vat numeric(18,2);
  v_total numeric(18,2);
begin
  select status into v_status from bills where id = p_bill_id;
  if not found or v_status not in ('draft', 'matched') then
    return;
  end if;
  for v_line in
    select quantity, unit_price, discount_percent, discount_amount, vat_rate
      from bill_lines where bill_id = p_bill_id order by line_number
  loop
    select * into v_net, v_vat, v_total
      from compute_quotation_line_amounts(
        v_line.quantity, v_line.unit_price, v_line.discount_percent,
        v_line.discount_amount, v_line.vat_rate
      );
    v_subtotal := v_subtotal + v_net;
    v_vat_total := v_vat_total + v_vat;
  end loop;
  perform set_config('app.bill_recalc_in_progress', 'true', true);
  update bills
     set subtotal = v_subtotal,
         vat_total = v_vat_total,
         grand_total = v_subtotal + v_vat_total,
         updated_at = now()
   where id = p_bill_id;
  perform set_config('app.bill_recalc_in_progress', 'false', true);
end;
$$;

create or replace function trg_refresh_bill_totals_from_lines()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform recalculate_bill_totals(coalesce(new.bill_id, old.bill_id));
  return coalesce(new, old);
end;
$$;
create trigger trg_refresh_bill_totals_from_lines
  after insert or update or delete on bill_lines
  for each row execute function trg_refresh_bill_totals_from_lines();

create or replace function prevent_bill_computed_totals_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_setting('app.bill_recalc_in_progress', true) = 'true'
     or current_setting('app.bill_payment_apply_in_progress', true) = 'true'
     or current_setting('app.bill_issue_in_progress', true) = 'true' then
    return new;
  end if;
  if new.subtotal is distinct from old.subtotal
     or new.vat_total is distinct from old.vat_total
     or new.grand_total is distinct from old.grand_total then
    raise exception 'BILL_TOTALS_CLIENT_MUTATION_BLOCKED';
  end if;
  if new.amount_paid is distinct from old.amount_paid
     or new.paid_at is distinct from old.paid_at then
    raise exception 'BILL_AMOUNT_PAID_CLIENT_MUTATION_BLOCKED';
  end if;
  return new;
end;
$$;
create trigger trg_prevent_bill_computed_totals_mutation
  before update on bills
  for each row execute function prevent_bill_computed_totals_mutation();

create or replace function prevent_locked_bill_line_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status bill_status;
begin
  select status into v_status from bills where id = coalesce(new.bill_id, old.bill_id);
  if v_status not in ('draft', 'matched') then
    raise exception 'BILL_LINE_MUTATION_BLOCKED';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger trg_prevent_locked_bill_line_mutation
  before insert or update or delete on bill_lines
  for each row execute function prevent_locked_bill_line_mutation();

create or replace function prevent_locked_bill_header_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_setting('app.bill_recalc_in_progress', true) = 'true'
     or current_setting('app.bill_payment_apply_in_progress', true) = 'true'
     or current_setting('app.bill_issue_in_progress', true) = 'true' then
    return new;
  end if;
  if old.status not in ('draft', 'matched') then
    if new.supplier_id is distinct from old.supplier_id
       or new.bill_date is distinct from old.bill_date
       or new.payment_terms is distinct from old.payment_terms
       or new.custom_days is distinct from old.custom_days
       or new.purchase_order_id is distinct from old.purchase_order_id
       or new.bill_number is distinct from old.bill_number
       or new.supplier_invoice_number is distinct from old.supplier_invoice_number
       or new.due_date is distinct from old.due_date then
      raise exception 'BILL_HEADER_MUTATION_BLOCKED';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_prevent_locked_bill_header_mutation
  before update on bills
  for each row execute function prevent_locked_bill_header_mutation();

create or replace function flag_duplicate_bill(p_bill_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_bill bills%rowtype;
  v_match uuid;
begin
  select * into v_bill from bills where id = p_bill_id;
  if not found then
    return null;
  end if;
  select b.id into v_match
    from bills b
   where b.company_id = v_bill.company_id
     and b.supplier_id = v_bill.supplier_id
     and b.id <> v_bill.id
     and b.status <> 'void'
     and (
       (v_bill.supplier_invoice_number is not null
        and btrim(v_bill.supplier_invoice_number) <> ''
        and b.supplier_invoice_number = v_bill.supplier_invoice_number)
       or (v_bill.grand_total > 0
           and b.grand_total = v_bill.grand_total
           and abs(b.bill_date - v_bill.bill_date) <= 30)
     )
   order by abs(b.bill_date - v_bill.bill_date), b.created_at
   limit 1;
  perform set_config('app.bill_issue_in_progress', 'true', true);
  update bills set possible_duplicate_of = v_match, updated_at = now() where id = p_bill_id;
  perform set_config('app.bill_issue_in_progress', 'false', true);
  return v_match;
end;
$$;

create or replace function trg_flag_duplicate_bill()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_setting('app.bill_issue_in_progress', true) = 'true'
     or current_setting('app.bill_recalc_in_progress', true) = 'true' then
    return new;
  end if;
  perform flag_duplicate_bill(new.id);
  select possible_duplicate_of into new.possible_duplicate_of from bills where id = new.id;
  return new;
end;
$$;
-- AFTER so grand_total from line recalc is visible; skip when GUC set.
create trigger trg_flag_duplicate_bill
  after insert or update of supplier_id, grand_total, bill_date, supplier_invoice_number
  on bills
  for each row execute function trg_flag_duplicate_bill();


create or replace function run_three_way_match(p_bill_id uuid)
returns bill_match_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bill bills%rowtype;
  v_qty_pct numeric(5,2);
  v_price_pct numeric(5,2);
  v_qty_fail boolean := false;
  v_price_fail boolean := false;
  v_has_receipt boolean := false;
  v_status bill_match_status;
  v_line record;
  v_ordered numeric;
  v_received numeric;
  v_po_price numeric(18,2);
  v_details jsonb := '[]'::jsonb;
  v_gr_id uuid;
begin
  select * into v_bill from bills where id = p_bill_id for update;
  if not found then
    raise exception 'BILL_NOT_FOUND';
  end if;

  if v_bill.purchase_order_id is null then
    v_status := 'no_po';
    insert into three_way_match_results (bill_id, match_status, details)
    values (p_bill_id, v_status, '{"reason":"no_po"}'::jsonb);
    perform set_config('app.bill_issue_in_progress', 'true', true);
    update bills set match_status = v_status, status = case when status = 'draft' then 'matched' else status end, updated_at = now()
     where id = p_bill_id;
    perform set_config('app.bill_issue_in_progress', 'false', true);
    return v_status;
  end if;

  select three_way_match_qty_tolerance_pct, three_way_match_price_tolerance_pct
    into v_qty_pct, v_price_pct
    from company_settings
   where company_id = v_bill.company_id;
  v_qty_pct := coalesce(v_qty_pct, 0);
  v_price_pct := coalesce(v_price_pct, 2);

  select exists(
    select 1 from goods_receipts where purchase_order_id = v_bill.purchase_order_id
  ) into v_has_receipt;

  if not v_has_receipt then
    v_status := 'awaiting_receipt';
    insert into three_way_match_results (bill_id, purchase_order_id, match_status, details)
    values (p_bill_id, v_bill.purchase_order_id, v_status, '{"reason":"awaiting_receipt"}'::jsonb);
    perform set_config('app.bill_issue_in_progress', 'true', true);
    update bills set match_status = v_status, status = case when status = 'draft' then 'matched' else status end, updated_at = now()
     where id = p_bill_id;
    perform set_config('app.bill_issue_in_progress', 'false', true);
    return v_status;
  end if;

  select id into v_gr_id
    from goods_receipts
   where purchase_order_id = v_bill.purchase_order_id
   order by receipt_date desc, created_at desc
   limit 1;

  for v_line in
    select bl.*
      from bill_lines bl
     where bl.bill_id = p_bill_id
       and bl.purchase_order_line_id is not null
  loop
    select quantity, unit_price into v_ordered, v_po_price
      from purchase_order_lines
     where id = v_line.purchase_order_line_id;
    select coalesce(sum(grl.quantity_received), 0) into v_received
      from goods_receipt_lines grl
      join goods_receipts gr on gr.id = grl.goods_receipt_id
     where grl.purchase_order_line_id = v_line.purchase_order_line_id
       and gr.purchase_order_id = v_bill.purchase_order_id;

    if v_line.quantity > v_ordered * (1 + v_qty_pct / 100)
       or v_line.quantity > v_received * (1 + v_qty_pct / 100) then
      v_qty_fail := true;
    end if;
    if v_po_price = 0 then
      if v_line.unit_price <> 0 then
        v_price_fail := true;
      end if;
    elsif abs(v_line.unit_price - v_po_price) / v_po_price > v_price_pct / 100 then
      v_price_fail := true;
    end if;

    v_details := v_details || jsonb_build_array(jsonb_build_object(
      'bill_line_id', v_line.id,
      'ordered', v_ordered,
      'received', v_received,
      'billed', v_line.quantity,
      'po_unit', v_po_price,
      'bill_unit', v_line.unit_price
    ));
  end loop;

  v_status := case
    when v_qty_fail and v_price_fail then 'quantity_and_price_mismatch'
    when v_qty_fail then 'quantity_mismatch'
    when v_price_fail then 'price_mismatch'
    else 'matched'
  end;

  insert into three_way_match_results (bill_id, purchase_order_id, goods_receipt_id, match_status, details)
  values (p_bill_id, v_bill.purchase_order_id, v_gr_id, v_status, v_details);

  perform set_config('app.bill_issue_in_progress', 'true', true);
  update bills
     set match_status = v_status,
         status = case when status = 'draft' then 'matched' else status end,
         updated_at = now()
   where id = p_bill_id;
  perform set_config('app.bill_issue_in_progress', 'false', true);
  return v_status;
end;
$$;
revoke all on function run_three_way_match(uuid) from public;
revoke all on function run_three_way_match(uuid) from authenticated;
revoke all on function run_three_way_match(uuid) from anon;
grant execute on function run_three_way_match(uuid) to service_role;

create or replace function create_bill_journal_entry(
  p_bill_id uuid,
  p_created_by uuid,
  p_immediate_post boolean,
  p_reference_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bill bills%rowtype;
  v_period accounting_periods%rowtype;
  v_entry_number bigint;
  v_entry journal_entries%rowtype;
  v_lines jsonb;
  v_line record;
  v_ap_id uuid;
  v_discount_id uuid;
  v_vat_id uuid;
  v_rcm_in_id uuid;
  v_rcm_out_id uuid;
  v_entertain_id uuid;
  v_blocked_id uuid;
  v_line_number int := 0;
  v_gross numeric(18,2);
  v_discount numeric(18,2);
  v_net numeric(18,2);
  v_line_vat numeric(18,2);
  v_rcm_vat numeric(18,2);
  v_standard_rate numeric(5,2);
  v_gross_sum numeric(18,2) := 0;
  v_discount_sum numeric(18,2) := 0;
  v_total_debits numeric(18,2);
  v_total_credits numeric(18,2);
  v_ref text;
  v_target_status journal_entry_status;
  v_treatment vat_input_treatment;
begin
  if p_created_by is null then
    raise exception 'CREATED_BY_REQUIRED';
  end if;
  select * into v_bill from bills where id = p_bill_id;
  if not found then
    raise exception 'BILL_NOT_FOUND';
  end if;
  if v_bill.journal_entry_id is not null then
    raise exception 'BILL_JOURNAL_ALREADY_POSTED';
  end if;
  if not exists (select 1 from bill_lines where bill_id = p_bill_id) then
    raise exception 'BILL_REQUIRES_LINES';
  end if;

  select id into v_ap_id from accounts
   where company_id = v_bill.company_id and account_number = '2000';
  select id into v_discount_id from accounts
   where company_id = v_bill.company_id and account_number = '5060';
  select id into v_vat_id from accounts
   where company_id = v_bill.company_id and account_number = '1400';
  select id into v_rcm_in_id from accounts
   where company_id = v_bill.company_id and account_number = '1410' and is_active = true;
  select id into v_rcm_out_id from accounts
   where company_id = v_bill.company_id and account_number = '2210' and is_active = true;
  select id into v_entertain_id from accounts
   where company_id = v_bill.company_id and account_number = '5580' and is_active = true;
  select id into v_blocked_id from accounts
   where company_id = v_bill.company_id and account_number = '5800' and is_active = true;
  if v_ap_id is null or v_discount_id is null or v_vat_id is null then
    raise exception 'BILL_POSTING_ACCOUNT_NOT_FOUND';
  end if;

  v_standard_rate := effective_vat_standard_rate(v_bill.bill_date);

  select * into v_period
    from accounting_periods
   where company_id = v_bill.company_id
     and status = 'open'
     and period_start <= v_bill.bill_date
     and period_end > v_bill.bill_date
   order by period_start
   limit 1;
  if not found then
    raise exception 'NO_OPEN_PERIOD_FOR_BILL_DATE';
  end if;

  for v_line in
    select * from bill_lines where bill_id = p_bill_id order by line_number
  loop
    if v_line.account_id is null then
      raise exception 'BILL_LINE_MISSING_ACCOUNT';
    end if;
    v_gross := round(v_line.quantity * v_line.unit_price, 2);
    if v_line.discount_percent is not null then
      v_discount := round(v_gross * v_line.discount_percent / 100, 2);
    elsif v_line.discount_amount is not null then
      v_discount := v_line.discount_amount;
    else
      v_discount := 0;
    end if;
    v_gross_sum := v_gross_sum + v_gross;
    v_discount_sum := v_discount_sum + v_discount;
  end loop;

  v_total_debits := v_gross_sum + v_bill.vat_total;
  v_total_credits := v_bill.grand_total + v_discount_sum;
  if v_total_debits <> v_total_credits then
    raise exception 'BILL_POSTING_UNBALANCED';
  end if;

  v_ref := coalesce(nullif(btrim(p_reference_number), ''), v_bill.bill_number);
  v_entry_number := allocate_next_entry_number(v_bill.company_id);

  insert into journal_entries (
    company_id, entry_number, period_id, entry_date, entry_type, status,
    narration, reference_number, created_by
  ) values (
    v_bill.company_id, v_entry_number, v_period.id, v_bill.bill_date, 'purchase_invoice', 'draft',
    case when v_ref is not null then 'Purchase invoice ' || v_ref else 'Purchase invoice' end,
    v_ref, p_created_by
  )
  returning * into v_entry;

  for v_line in
    select * from bill_lines where bill_id = p_bill_id order by line_number
  loop
    v_gross := round(v_line.quantity * v_line.unit_price, 2);
    v_line_number := v_line_number + 1;
    insert into journal_lines (journal_entry_id, line_number, account_id, debit, credit, description)
    values (v_entry.id, v_line_number, v_line.account_id, v_gross, 0, v_line.description);
  end loop;

  if v_bill.vat_total > 0 then
    v_line_number := v_line_number + 1;
    insert into journal_lines (journal_entry_id, line_number, account_id, debit, credit, description)
    values (v_entry.id, v_line_number, v_vat_id, v_bill.vat_total, 0, 'VAT Receivable (Input VAT)');
  end if;

  -- [feature-spec-1_1_F.md F-3 / F-25 / F-26] RCM legs and blocked-input reclass on the same purchase_invoice JE.
  for v_line in
    select * from bill_lines where bill_id = p_bill_id order by line_number
  loop
    v_gross := round(v_line.quantity * v_line.unit_price, 2);
    if v_line.discount_percent is not null then
      v_discount := round(v_gross * v_line.discount_percent / 100, 2);
    elsif v_line.discount_amount is not null then
      v_discount := v_line.discount_amount;
    else
      v_discount := 0;
    end if;
    v_net := v_gross - v_discount;
    v_line_vat := round(v_net * v_line.vat_rate / 100, 2);
    v_treatment := v_line.vat_input_treatment;
    if v_treatment is null and v_line.vat_category = 'standard_rated' then
      v_treatment := 'recoverable';
    end if;

    if v_treatment = 'reverse_charge' then
      if v_rcm_in_id is null or v_rcm_out_id is null then
        raise exception 'BILL_POSTING_ACCOUNT_NOT_FOUND';
      end if;
      v_rcm_vat := round(v_net * v_standard_rate / 100, 2);
      if v_rcm_vat > 0 then
        v_line_number := v_line_number + 1;
        insert into journal_lines (journal_entry_id, line_number, account_id, debit, credit, description)
        values (v_entry.id, v_line_number, v_rcm_in_id, v_rcm_vat, 0, 'VAT Receivable - Reverse Charge');
        v_line_number := v_line_number + 1;
        insert into journal_lines (journal_entry_id, line_number, account_id, debit, credit, description)
        values (v_entry.id, v_line_number, v_rcm_out_id, 0, v_rcm_vat, 'VAT Payable - Reverse Charge');
      end if;
    elsif v_treatment = 'blocked_entertainment' and v_line_vat > 0 then
      if v_entertain_id is null then
        raise exception 'BILL_POSTING_ACCOUNT_NOT_FOUND';
      end if;
      v_line_number := v_line_number + 1;
      insert into journal_lines (journal_entry_id, line_number, account_id, debit, credit, description)
      values (v_entry.id, v_line_number, v_entertain_id, v_line_vat, 0, 'Blocked input VAT - entertainment');
      v_line_number := v_line_number + 1;
      insert into journal_lines (journal_entry_id, line_number, account_id, debit, credit, description)
      values (v_entry.id, v_line_number, v_vat_id, 0, v_line_vat, 'Reclass blocked input VAT');
    elsif v_treatment = 'blocked_other' and v_line_vat > 0 then
      if v_blocked_id is null then
        raise exception 'BILL_POSTING_ACCOUNT_NOT_FOUND';
      end if;
      v_line_number := v_line_number + 1;
      insert into journal_lines (journal_entry_id, line_number, account_id, debit, credit, description)
      values (v_entry.id, v_line_number, v_blocked_id, v_line_vat, 0, 'Non-recoverable input VAT');
      v_line_number := v_line_number + 1;
      insert into journal_lines (journal_entry_id, line_number, account_id, debit, credit, description)
      values (v_entry.id, v_line_number, v_vat_id, 0, v_line_vat, 'Reclass blocked input VAT');
    end if;
  end loop;

  if v_discount_sum > 0 then
    v_line_number := v_line_number + 1;
    insert into journal_lines (journal_entry_id, line_number, account_id, debit, credit, description)
    values (v_entry.id, v_line_number, v_discount_id, 0, v_discount_sum, 'Purchase Discounts & Returns');
  end if;

  v_line_number := v_line_number + 1;
  insert into journal_lines (journal_entry_id, line_number, account_id, debit, credit, description)
  values (v_entry.id, v_line_number, v_ap_id, 0, v_bill.grand_total, 'Accounts Payable - Trade');

  v_target_status := case when p_immediate_post then 'posted' else 'pending_approval' end;
  update journal_entries
     set status = v_target_status
   where id = v_entry.id
     and status = 'draft'
  returning * into v_entry;

  if not found then
    raise exception 'Failed to post purchase invoice entry %', v_entry_number;
  end if;

  select coalesce(jsonb_agg(to_jsonb(jl) order by jl.line_number), '[]'::jsonb)
    into v_lines from journal_lines jl where jl.journal_entry_id = v_entry.id;

  return jsonb_build_object(
    'entry', to_jsonb(v_entry),
    'lines', v_lines,
    'journal_entry_id', v_entry.id
  );
end;
$$;
revoke all on function create_bill_journal_entry(uuid, uuid, boolean, text) from public;
revoke all on function create_bill_journal_entry(uuid, uuid, boolean, text) from authenticated;
revoke all on function create_bill_journal_entry(uuid, uuid, boolean, text) from anon;
grant execute on function create_bill_journal_entry(uuid, uuid, boolean, text) to service_role;

create or replace function issue_bill(
  p_bill_id uuid,
  p_created_by uuid,
  p_immediate_post boolean
)
returns bills
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bill bills%rowtype;
  v_due_date date;
  v_number text;
  v_journal jsonb;
  v_journal_entry_id uuid;
begin
  if p_created_by is null then
    raise exception 'CREATED_BY_REQUIRED';
  end if;
  select * into v_bill from bills where id = p_bill_id for update;
  if not found then
    raise exception 'BILL_NOT_FOUND';
  end if;
  if v_bill.status not in ('draft', 'matched') then
    raise exception 'BILL_NOT_OPEN_FOR_ISSUE';
  end if;
  if not exists (select 1 from bill_lines where bill_id = p_bill_id) then
    raise exception 'BILL_REQUIRES_LINES';
  end if;

  -- [feature-spec-1_1_F.md F-19 / F-25 / F-38]
  perform assert_bill_vat_ready(p_bill_id);
  perform assert_not_filed_vat_period(
    v_bill.company_id, v_bill.bill_date, false, true
  );

  perform run_three_way_match(p_bill_id);
  perform flag_duplicate_bill(p_bill_id);

  v_due_date := case v_bill.payment_terms
    when 'net_7' then v_bill.bill_date + 7
    when 'net_15' then v_bill.bill_date + 15
    when 'net_30' then v_bill.bill_date + 30
    when 'net_60' then v_bill.bill_date + 60
    when 'custom' then v_bill.bill_date + v_bill.custom_days
    when 'cod' then v_bill.bill_date
  end;
  v_number := allocate_next_bill_number(v_bill.company_id, v_bill.bill_date);

  perform set_config('app.bill_issue_in_progress', 'true', true);
  update bills
     set bill_number = v_number, due_date = v_due_date, updated_at = now()
   where id = p_bill_id;

  v_journal := create_bill_journal_entry(p_bill_id, p_created_by, p_immediate_post, v_number);
  v_journal_entry_id := (v_journal->>'journal_entry_id')::uuid;

  update bills
     set status = case when p_immediate_post then 'issued'::bill_status else 'pending_approval'::bill_status end,
         journal_entry_id = v_journal_entry_id,
         updated_at = now()
   where id = p_bill_id
  returning * into v_bill;
  perform set_config('app.bill_issue_in_progress', 'false', true);
  return v_bill;
end;
$$;
revoke all on function issue_bill(uuid, uuid, boolean) from public;
revoke all on function issue_bill(uuid, uuid, boolean) from authenticated;
revoke all on function issue_bill(uuid, uuid, boolean) from anon;
grant execute on function issue_bill(uuid, uuid, boolean) to service_role;

create or replace function void_bill(
  p_bill_id uuid,
  p_void_reason text,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bill bills%rowtype;
  v_reversal jsonb;
  v_ledger_status text;
  v_je_status journal_entry_status;
begin
  if p_created_by is null then
    raise exception 'CREATED_BY_REQUIRED';
  end if;
  if p_void_reason is null or btrim(p_void_reason) = '' then
    raise exception 'VOID_REASON_REQUIRED';
  end if;
  select * into v_bill from bills where id = p_bill_id for update;
  if not found then
    raise exception 'BILL_NOT_FOUND';
  end if;
  if v_bill.status not in ('issued', 'partially_paid', 'pending_approval', 'disputed') then
    raise exception 'BILL_VOID_NOT_PERMITTED';
  end if;

  -- [feature-spec-1_1_F.md F-38]
  perform assert_not_filed_vat_period(
    v_bill.company_id, v_bill.bill_date, false, true
  );

  -- [feature-spec-1_1_E.md §4.1 / E-13] reverse only when the JE is posted.
  -- pending_approval JEs are unposted; reject them so approve cannot post after void.
  if v_bill.journal_entry_id is not null then
    select status into v_je_status from journal_entries where id = v_bill.journal_entry_id;
    if v_je_status = 'posted' then
      v_reversal := reverse_journal_entry(v_bill.journal_entry_id, p_created_by);
      v_ledger_status := 'reversed';
    elsif v_je_status = 'pending_approval' then
      update journal_entries
         set status = 'rejected',
             rejected_by = p_created_by,
             rejected_at = now(),
             rejection_reason = btrim(p_void_reason),
             updated_at = now()
       where id = v_bill.journal_entry_id
         and status = 'pending_approval';
      v_ledger_status := 'skipped_no_posting';
    else
      v_ledger_status := 'skipped_no_posting';
    end if;
  else
    v_ledger_status := 'skipped_no_posting';
  end if;

  perform set_config('app.bill_issue_in_progress', 'true', true);
  update bills
     set status = 'void', void_reason = btrim(p_void_reason), updated_at = now()
   where id = p_bill_id
  returning * into v_bill;
  perform set_config('app.bill_issue_in_progress', 'false', true);

  return jsonb_build_object('bill', to_jsonb(v_bill), 'ledger_reversal_status', v_ledger_status, 'reversal', v_reversal);
end;
$$;
revoke all on function void_bill(uuid, text, uuid) from public;
revoke all on function void_bill(uuid, text, uuid) from authenticated;
revoke all on function void_bill(uuid, text, uuid) from anon;
grant execute on function void_bill(uuid, text, uuid) to service_role;

create or replace function sync_bill_issued_on_je_post()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.entry_type = 'purchase_invoice'
     and new.status = 'posted'
     and old.status = 'pending_approval' then
    perform set_config('app.bill_issue_in_progress', 'true', true);
    update bills
       set status = 'issued', updated_at = now()
     where journal_entry_id = new.id
       and status = 'pending_approval';
    perform set_config('app.bill_issue_in_progress', 'false', true);
  end if;
  return new;
end;
$$;
create trigger trg_sync_bill_issued_on_je_post
  after update on journal_entries
  for each row execute function sync_bill_issued_on_je_post();

create or replace function set_supplier_payment_unapplied_on_insert()
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
create trigger trg_set_supplier_payment_unapplied_on_insert
  before insert on supplier_payments
  for each row execute function set_supplier_payment_unapplied_on_insert();

create or replace function refresh_supplier_payment_unapplied_amount()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_payment_id uuid;
  v_applied numeric(18,2);
  v_amount numeric(18,2);
begin
  v_payment_id := coalesce(new.supplier_payment_id, old.supplier_payment_id);
  perform pg_advisory_xact_lock(hashtext('spay:' || v_payment_id::text));
  select amount into v_amount from supplier_payments where id = v_payment_id;
  select coalesce(sum(applied_amount), 0) into v_applied
    from supplier_payment_applications where supplier_payment_id = v_payment_id;
  if v_applied > v_amount then
    raise exception 'SUPPLIER_PAYMENT_OVER_APPLIED';
  end if;
  update supplier_payments
     set unapplied_amount = v_amount - v_applied, updated_at = now()
   where id = v_payment_id;
  return coalesce(new, old);
end;
$$;
create trigger trg_refresh_supplier_payment_unapplied
  after insert or update or delete on supplier_payment_applications
  for each row execute function refresh_supplier_payment_unapplied_amount();

create or replace function bill_is_payable(p_bill bills)
returns void
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  -- [feature-spec-1_1_E.md E-20] disputed is checked first so the token is BILL_DISPUTED, not BILL_NOT_OPEN_FOR_PAYMENT.
  if p_bill.status = 'disputed' then
    raise exception 'BILL_DISPUTED';
  end if;
  if p_bill.status not in ('issued', 'partially_paid') then
    raise exception 'BILL_NOT_OPEN_FOR_PAYMENT';
  end if;
  if p_bill.match_status is distinct from 'matched'
     and p_bill.match_status is distinct from 'no_po'
     and p_bill.payment_match_override_reason is null then
    raise exception 'BILL_MATCH_BLOCKS_PAYMENT';
  end if;
end;
$$;

create or replace function refresh_bill_amount_paid_from_applications()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_bill bills%rowtype;
  v_paid numeric(18,2);
  v_bill_id uuid;
begin
  v_bill_id := coalesce(new.bill_id, old.bill_id);
  perform pg_advisory_xact_lock(hashtext('bilpay:' || v_bill_id::text));
  select * into v_bill from bills where id = v_bill_id for update;
  -- [feature-spec-1_1_E.md E-20] payable is an insert-time check. Stamping
  -- journal_entry_id on an existing application (advance reclass) must not
  -- re-run it after the bill has already moved to paid.
  if tg_op = 'INSERT'
     or (tg_op = 'UPDATE'
         and (new.bill_id is distinct from old.bill_id
              or new.applied_amount is distinct from old.applied_amount)) then
    perform bill_is_payable(v_bill);
  end if;
  select coalesce(sum(applied_amount), 0) into v_paid
    from supplier_payment_applications where bill_id = v_bill_id;
  if v_paid > v_bill.grand_total then
    raise exception 'BILL_APPLICATION_EXCEEDS_BALANCE';
  end if;
  perform set_config('app.bill_payment_apply_in_progress', 'true', true);
  update bills
     set amount_paid = v_paid,
         status = case
           when status in ('void', 'disputed', 'pending_approval', 'draft', 'matched') then status
           when v_paid = 0 then 'issued'
           when v_paid < grand_total then 'partially_paid'
           else 'paid'
         end,
         paid_at = case
           when v_paid = grand_total and paid_at is null then now()
           when v_paid < grand_total then null
           else paid_at
         end,
         updated_at = now()
   where id = v_bill_id;
  perform set_config('app.bill_payment_apply_in_progress', 'false', true);
  return coalesce(new, old);
end;
$$;
create trigger trg_refresh_bill_amount_paid
  after insert or update or delete on supplier_payment_applications
  for each row execute function refresh_bill_amount_paid_from_applications();

create or replace function create_supplier_payment_journal_entry(
  p_payment_id uuid,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment supplier_payments%rowtype;
  v_period accounting_periods%rowtype;
  v_entry_number bigint;
  v_entry journal_entries%rowtype;
  v_lines jsonb;
  v_credit_id uuid;
  v_debit_id uuid;
  v_debit_number text;
  v_entry_type journal_entry_type;
  v_has_applications boolean;
  v_ref text;
begin
  if p_created_by is null then
    raise exception 'CREATED_BY_REQUIRED';
  end if;
  select * into v_payment from supplier_payments where id = p_payment_id for update;
  if not found then
    raise exception 'SUPPLIER_PAYMENT_NOT_FOUND';
  end if;
  if v_payment.journal_entry_id is not null then
    raise exception 'SUPPLIER_PAYMENT_ALREADY_POSTED';
  end if;

  select exists(
    select 1 from supplier_payment_applications where supplier_payment_id = p_payment_id
  ) into v_has_applications;

  if v_has_applications then
    v_entry_type := 'supplier_payment';
    v_debit_number := '2000';
  else
    v_entry_type := 'supplier_advance';
    v_debit_number := '1350';
  end if;

  select id into v_debit_id from accounts
   where company_id = v_payment.company_id and account_number = v_debit_number and is_active = true;
  if v_debit_id is null then
    raise exception 'SUPPLIER_PAYMENT_ACCOUNT_NOT_FOUND';
  end if;

  v_credit_id := resolve_payment_debit_account_id(
    v_payment.company_id, v_payment.bank_account_id, v_payment.payment_method
  );

  select * into v_period
    from accounting_periods
   where company_id = v_payment.company_id
     and status = 'open'
     and period_start <= v_payment.payment_date
     and period_end > v_payment.payment_date
   order by period_start limit 1;
  if not found then
    raise exception 'NO_OPEN_PERIOD_FOR_PAYMENT_DATE';
  end if;

  v_ref := coalesce(nullif(btrim(v_payment.reference_number), ''), 'spay:' || v_payment.id::text);
  v_entry_number := allocate_next_entry_number(v_payment.company_id);

  insert into journal_entries (
    company_id, entry_number, period_id, entry_date, entry_type, status, narration, reference_number, created_by
  ) values (
    v_payment.company_id, v_entry_number, v_period.id, v_payment.payment_date, v_entry_type, 'draft',
    case when v_entry_type = 'supplier_advance' then 'Supplier advance' else 'Supplier payment' end,
    v_ref, p_created_by
  )
  returning * into v_entry;

  insert into journal_lines (journal_entry_id, line_number, account_id, debit, credit, description)
  values
    (v_entry.id, 1, v_debit_id, v_payment.amount, 0,
     case when v_entry_type = 'supplier_advance' then 'Supplier Advances' else 'Accounts Payable - Trade' end),
    (v_entry.id, 2, v_credit_id, 0, v_payment.amount, 'Bank/Cash');

  update journal_entries set status = 'posted' where id = v_entry.id and status = 'draft' returning * into v_entry;
  if not found then
    raise exception 'Failed to post supplier payment entry %', v_entry_number;
  end if;

  update supplier_payments set journal_entry_id = v_entry.id, updated_at = now() where id = p_payment_id;

  select coalesce(jsonb_agg(to_jsonb(jl) order by jl.line_number), '[]'::jsonb)
    into v_lines from journal_lines jl where jl.journal_entry_id = v_entry.id;
  return jsonb_build_object('entry', to_jsonb(v_entry), 'lines', v_lines, 'journal_entry_id', v_entry.id);
end;
$$;
revoke all on function create_supplier_payment_journal_entry(uuid, uuid) from public;
revoke all on function create_supplier_payment_journal_entry(uuid, uuid) from authenticated;
revoke all on function create_supplier_payment_journal_entry(uuid, uuid) from anon;
grant execute on function create_supplier_payment_journal_entry(uuid, uuid) to service_role;

create or replace function create_supplier_advance_application_journal_entry(
  p_application_id uuid,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_app supplier_payment_applications%rowtype;
  v_payment supplier_payments%rowtype;
  v_period accounting_periods%rowtype;
  v_entry journal_entries%rowtype;
  v_entry_number bigint;
  v_ap_id uuid;
  v_adv_id uuid;
  v_lines jsonb;
begin
  if p_created_by is null then
    raise exception 'CREATED_BY_REQUIRED';
  end if;
  select * into v_app from supplier_payment_applications where id = p_application_id for update;
  if not found then
    raise exception 'SUPPLIER_PAYMENT_APPLICATION_NOT_FOUND';
  end if;
  if v_app.journal_entry_id is not null then
    raise exception 'SUPPLIER_ADVANCE_APPLICATION_ALREADY_POSTED';
  end if;
  select * into v_payment from supplier_payments where id = v_app.supplier_payment_id;
  -- Payable was enforced when the application row was inserted. The bill may
  -- already be `paid` here (full application) — do not re-run bill_is_payable.
  -- [feature-spec-1_1_E.md §4.5 / E-20] mirrors D create_advance_application_journal_entry.

  if v_payment.journal_entry_id is null then
    raise exception 'SUPPLIER_PAYMENT_NOT_POSTED';
  end if;

  select entry_type into v_entry.entry_type from journal_entries where id = v_payment.journal_entry_id;
  if (select entry_type from journal_entries where id = v_payment.journal_entry_id) <> 'supplier_advance' then
    raise exception 'SUPPLIER_PAYMENT_NOT_ADVANCE';
  end if;

  select id into v_ap_id from accounts where company_id = v_payment.company_id and account_number = '2000';
  select id into v_adv_id from accounts where company_id = v_payment.company_id and account_number = '1350';
  if v_ap_id is null or v_adv_id is null then
    raise exception 'SUPPLIER_PAYMENT_ACCOUNT_NOT_FOUND';
  end if;

  select * into v_period
    from accounting_periods
   where company_id = v_payment.company_id
     and status = 'open'
     and period_start <= v_app.applied_at::date
     and period_end > v_app.applied_at::date
   order by period_start limit 1;
  if not found then
    raise exception 'NO_OPEN_PERIOD_FOR_PAYMENT_DATE';
  end if;

  v_entry_number := allocate_next_entry_number(v_payment.company_id);
  insert into journal_entries (
    company_id, entry_number, period_id, entry_date, entry_type, status, narration, reference_number, created_by
  ) values (
    v_payment.company_id, v_entry_number, v_period.id, v_app.applied_at::date,
    'supplier_advance_application', 'draft',
    'Supplier advance application', 'spa:' || v_app.id::text, p_created_by
  )
  returning * into v_entry;

  insert into journal_lines (journal_entry_id, line_number, account_id, debit, credit, description) values
    (v_entry.id, 1, v_ap_id, v_app.applied_amount, 0, 'Accounts Payable - Trade'),
    (v_entry.id, 2, v_adv_id, 0, v_app.applied_amount, 'Supplier Advances');

  update journal_entries set status = 'posted' where id = v_entry.id and status = 'draft' returning * into v_entry;
  update supplier_payment_applications set journal_entry_id = v_entry.id where id = p_application_id;

  select coalesce(jsonb_agg(to_jsonb(jl) order by jl.line_number), '[]'::jsonb)
    into v_lines from journal_lines jl where jl.journal_entry_id = v_entry.id;
  return jsonb_build_object('entry', to_jsonb(v_entry), 'lines', v_lines, 'journal_entry_id', v_entry.id);
end;
$$;
revoke all on function create_supplier_advance_application_journal_entry(uuid, uuid) from public;
revoke all on function create_supplier_advance_application_journal_entry(uuid, uuid) from authenticated;
revoke all on function create_supplier_advance_application_journal_entry(uuid, uuid) from anon;
grant execute on function create_supplier_advance_application_journal_entry(uuid, uuid) to service_role;

create or replace function execute_supplier_payment_run(
  p_run_id uuid,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run supplier_payment_runs%rowtype;
  v_item record;
  v_bill bills%rowtype;
  v_payment_id uuid;
  v_supplier uuid;
  v_amount numeric(18,2);
  v_payments jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_journal jsonb;
begin
  if p_created_by is null then
    raise exception 'CREATED_BY_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtext('payrun:' || p_run_id::text));
  select * into v_run from supplier_payment_runs where id = p_run_id for update;
  if not found then
    raise exception 'PAYMENT_RUN_NOT_FOUND';
  end if;
  if v_run.status <> 'approved' then
    raise exception 'PAYMENT_RUN_NOT_APPROVED';
  end if;

  for v_supplier, v_amount in
    select supplier_id, sum(amount_to_pay)
      from supplier_payment_run_items
     where run_id = p_run_id and included = true
     group by supplier_id
  loop
    insert into supplier_payments (
      company_id, supplier_id, payment_date, amount, payment_method,
      bank_account_id, payment_run_id, created_by
    ) values (
      v_run.company_id, v_supplier, v_run.run_date, v_amount, v_run.payment_method,
      v_run.bank_account_id, p_run_id, p_created_by
    )
    returning id into v_payment_id;

    for v_item in
      select * from supplier_payment_run_items
       where run_id = p_run_id and supplier_id = v_supplier and included = true
    loop
      select * into v_bill from bills where id = v_item.bill_id;
      begin
        perform bill_is_payable(v_bill);
        insert into supplier_payment_applications (
          supplier_payment_id, bill_id, applied_amount, applied_by
        ) values (
          v_payment_id, v_item.bill_id, v_item.amount_to_pay, p_created_by
        );
      exception when others then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'bill_id', v_item.bill_id, 'token', sqlerrm
        ));
      end;
    end loop;

    if exists (select 1 from supplier_payment_applications where supplier_payment_id = v_payment_id) then
      v_journal := create_supplier_payment_journal_entry(v_payment_id, p_created_by);
      v_payments := v_payments || jsonb_build_array(jsonb_build_object(
        'payment_id', v_payment_id, 'journal', v_journal
      ));
    else
      delete from supplier_payments where id = v_payment_id;
    end if;
  end loop;

  update supplier_payment_runs
     set status = 'executed', executed_at = now(), updated_at = now()
   where id = p_run_id;

  return jsonb_build_object('payments', v_payments, 'skipped', v_skipped);
end;
$$;
revoke all on function execute_supplier_payment_run(uuid, uuid) from public;
revoke all on function execute_supplier_payment_run(uuid, uuid) from authenticated;
revoke all on function execute_supplier_payment_run(uuid, uuid) from anon;
grant execute on function execute_supplier_payment_run(uuid, uuid) to service_role;

create or replace function accrue_unbilled_receipts(
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
  v_period accounting_periods%rowtype;
  v_prev grni_accrual_runs%rowtype;
  v_reversal jsonb;
  v_entry journal_entries%rowtype;
  v_entry_number bigint;
  v_grni_id uuid;
  v_line record;
  v_line_number int := 0;
  v_unmatched numeric;
  v_amount numeric(18,2);
  v_total numeric(18,2) := 0;
  v_lines jsonb;
begin
  if p_company_id is null then
    raise exception 'COMPANY_ID_REQUIRED';
  end if;
  if p_created_by is null then
    raise exception 'CREATED_BY_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtext('grni:' || p_company_id::text));

  if exists (select 1 from grni_accrual_runs where company_id = p_company_id and period_end_date = p_period_end_date) then
    raise exception 'GRNI_ALREADY_RUN';
  end if;

  select * into v_period
    from accounting_periods
   where company_id = p_company_id
     and period_start <= p_period_end_date
     and period_end > p_period_end_date
   limit 1;
  if not found then
    raise exception 'NO_PERIOD_FOR_GRNI_DATE';
  end if;
  if v_period.status = 'closed' then
    raise exception 'PERIOD_CLOSED';
  end if;

  select * into v_prev
    from grni_accrual_runs
   where company_id = p_company_id
     and reversal_entry_id is null
     and journal_entry_id is not null
   order by period_end_date desc
   limit 1;
  if found then
    v_reversal := reverse_journal_entry(v_prev.journal_entry_id, p_created_by);
    update grni_accrual_runs
       set reversal_entry_id = (v_reversal->'reversal'->>'id')::uuid
     where id = v_prev.id;
  end if;

  select id into v_grni_id from accounts
   where company_id = p_company_id and account_number = '2020' and is_active = true;
  if v_grni_id is null then
    raise exception 'GRNI_ACCOUNT_NOT_FOUND';
  end if;

  v_entry_number := allocate_next_entry_number(p_company_id);
  insert into journal_entries (
    company_id, entry_number, period_id, entry_date, entry_type, status, narration, created_by
  ) values (
    p_company_id, v_entry_number, v_period.id, p_period_end_date, 'grni_accrual', 'draft',
    'GRNI accrual ' || p_period_end_date::text, p_created_by
  )
  returning * into v_entry;

  for v_line in
    select
      pol.id as po_line_id,
      pol.account_id,
      pol.unit_price,
      pol.quantity as ordered,
      coalesce((
        select sum(grl.quantity_received)
          from goods_receipt_lines grl
          join goods_receipts gr on gr.id = grl.goods_receipt_id
         where grl.purchase_order_line_id = pol.id
           and gr.receipt_date <= p_period_end_date
      ), 0) as received,
      coalesce((
        select sum(bl.quantity)
          from bill_lines bl
          join bills b on b.id = bl.bill_id
         where bl.purchase_order_line_id = pol.id
           and b.status in ('issued', 'partially_paid', 'paid')
           and b.bill_date <= p_period_end_date
      ), 0) as billed
    from purchase_order_lines pol
    join purchase_orders po on po.id = pol.po_id
   where po.company_id = p_company_id
     and po.status <> 'cancelled'
  loop
    v_unmatched := v_line.received - v_line.billed;
    if v_unmatched > 0 then
      v_amount := round(v_unmatched * v_line.unit_price, 2);
      if v_amount > 0 then
        v_line_number := v_line_number + 1;
        insert into journal_lines (journal_entry_id, line_number, account_id, debit, credit, description)
        values (v_entry.id, v_line_number, v_line.account_id, v_amount, 0, 'Unbilled receipt');
        v_total := v_total + v_amount;
      end if;
    end if;
  end loop;

  if v_total = 0 then
    delete from journal_entries where id = v_entry.id;
    insert into grni_accrual_runs (company_id, period_end_date, accrual_amount, created_by)
    values (p_company_id, p_period_end_date, 0, p_created_by);
    return jsonb_build_object('accrual_amount', 0, 'journal_entry_id', null);
  end if;

  v_line_number := v_line_number + 1;
  insert into journal_lines (journal_entry_id, line_number, account_id, debit, credit, description)
  values (v_entry.id, v_line_number, v_grni_id, 0, v_total, 'Accrued Purchases (GRNI)');

  update journal_entries set status = 'posted' where id = v_entry.id and status = 'draft' returning * into v_entry;

  insert into grni_accrual_runs (
    company_id, period_end_date, accrual_amount, journal_entry_id, created_by
  ) values (
    p_company_id, p_period_end_date, v_total, v_entry.id, p_created_by
  );

  select coalesce(jsonb_agg(to_jsonb(jl) order by jl.line_number), '[]'::jsonb)
    into v_lines from journal_lines jl where jl.journal_entry_id = v_entry.id;
  return jsonb_build_object(
    'accrual_amount', v_total,
    'journal_entry_id', v_entry.id,
    'entry', to_jsonb(v_entry),
    'lines', v_lines,
    'prior_reversal', v_reversal
  );
end;
$$;
revoke all on function accrue_unbilled_receipts(uuid, date, uuid) from public;
revoke all on function accrue_unbilled_receipts(uuid, date, uuid) from authenticated;
revoke all on function accrue_unbilled_receipts(uuid, date, uuid) from anon;
grant execute on function accrue_unbilled_receipts(uuid, date, uuid) to service_role;

create or replace function get_supplier_ledger(
  p_company_id uuid,
  p_supplier_id uuid,
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
  affects_ap boolean,
  running_balance numeric(18,2),
  journal_entry_id uuid
)
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
begin
  if p_company_id is null then raise exception 'COMPANY_ID_REQUIRED'; end if;
  if p_supplier_id is null then raise exception 'SUPPLIER_ID_REQUIRED'; end if;
  if p_date_from is not null and p_date_to is not null and p_date_to < p_date_from then
    raise exception 'INVALID_DATE_RANGE';
  end if;
  if not exists (select 1 from suppliers s where s.id = p_supplier_id and s.company_id = p_company_id) then
    raise exception 'SUPPLIER_COMPANY_MISMATCH';
  end if;

  return query
  with raw as (
    select
      b.bill_date as entry_date,
      'bill'::text as source_type,
      b.id as source_id,
      b.bill_number as document_number,
      ('Bill ' || coalesce(b.bill_number, b.id::text))::text as description,
      0::numeric(18,2) as debit,
      b.grand_total as credit,
      true as affects_ap,
      b.journal_entry_id
    from bills b
    join journal_entries je on je.id = b.journal_entry_id
    where b.company_id = p_company_id
      and b.supplier_id = p_supplier_id
      and b.journal_entry_id is not null
      and b.status <> 'void'
      and is_ledger_truth_status(je.status)

    union all

    select
      spa.applied_at::date,
      'payment_application',
      spa.id,
      sp.reference_number,
      ('Payment application ' || spa.id::text),
      spa.applied_amount,
      0::numeric(18,2),
      true,
      sp.journal_entry_id
    from supplier_payment_applications spa
    join supplier_payments sp on sp.id = spa.supplier_payment_id
    join journal_entries je on je.id = sp.journal_entry_id
    where sp.company_id = p_company_id
      and sp.supplier_id = p_supplier_id
      and sp.journal_entry_id is not null
      and je.entry_type = 'supplier_payment'
      and is_ledger_truth_status(je.status)

    union all

    select
      spa.applied_at::date,
      'payment_application',
      spa.id,
      sp.reference_number,
      ('Advance application ' || spa.id::text),
      spa.applied_amount,
      0::numeric(18,2),
      true,
      je.id
    from supplier_payment_applications spa
    join supplier_payments sp on sp.id = spa.supplier_payment_id
    join journal_entries je
      on je.company_id = sp.company_id
     and je.entry_type = 'supplier_advance_application'
     and je.reference_number = 'spa:' || spa.id::text
    where sp.company_id = p_company_id
      and sp.supplier_id = p_supplier_id
      and is_ledger_truth_status(je.status)

    union all

    select
      sp.payment_date,
      'supplier_advance',
      sp.id,
      sp.reference_number,
      ('Supplier advance ' || coalesce(sp.reference_number, sp.id::text)),
      sp.amount,
      0::numeric(18,2),
      false,
      sp.journal_entry_id
    from supplier_payments sp
    join journal_entries je on je.id = sp.journal_entry_id
    where sp.company_id = p_company_id
      and sp.supplier_id = p_supplier_id
      and sp.journal_entry_id is not null
      and je.entry_type = 'supplier_advance'
      and is_ledger_truth_status(je.status)
  ),
  filtered as (
    select * from raw r
     where (p_date_from is null or r.entry_date >= p_date_from)
       and (p_date_to is null or r.entry_date <= p_date_to)
  ),
  ordered as (
    select
      f.*,
      row_number() over (order by f.entry_date, f.source_type, f.source_id) as sort_key,
      sum(case when f.affects_ap then f.credit - f.debit else 0 end) over (
        order by f.entry_date, f.source_type, f.source_id
        rows between unbounded preceding and current row
      )::numeric(18,2) as bal
    from filtered f
  )
  select
    o.entry_date, o.source_type, o.source_id, o.document_number, o.description,
    o.debit, o.credit, o.affects_ap,
    case when o.affects_ap then o.bal else null end,
    o.journal_entry_id
  from ordered o
  order by o.sort_key;
end;
$$;
revoke all on function get_supplier_ledger(uuid, uuid, date, date) from public;
revoke all on function get_supplier_ledger(uuid, uuid, date, date) from authenticated;
revoke all on function get_supplier_ledger(uuid, uuid, date, date) from anon;
grant execute on function get_supplier_ledger(uuid, uuid, date, date) to service_role;

create or replace function get_aged_payables(
  p_company_id uuid,
  p_as_of_date date
)
returns table (
  supplier_id uuid,
  supplier_name text,
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
  if p_company_id is null then raise exception 'COMPANY_ID_REQUIRED'; end if;
  if p_as_of_date is null then raise exception 'AS_OF_DATE_REQUIRED'; end if;
  v_as_of := p_as_of_date;
  return query
  with open_bills as (
    select
      b.supplier_id,
      s.supplier_name,
      (b.grand_total - b.amount_paid)::numeric(18,2) as outstanding,
      case
        when b.due_date is null or (v_as_of - b.due_date) <= 0 then 'current'
        when (v_as_of - b.due_date) between 1 and 30 then '0_30'
        when (v_as_of - b.due_date) between 31 and 60 then '31_60'
        when (v_as_of - b.due_date) between 61 and 90 then '61_90'
        else '90_plus'
      end as bucket
    from bills b
    join suppliers s on s.id = b.supplier_id
    where b.company_id = p_company_id
      and b.status in ('issued', 'partially_paid')
      and b.amount_paid < b.grand_total
      and b.journal_entry_id is not null
  ),
  per_supplier as (
    select
      ob.supplier_id,
      ob.supplier_name,
      false as is_totals,
      coalesce(sum(ob.outstanding) filter (where ob.bucket = 'current'), 0)::numeric(18,2) as bucket_current,
      coalesce(sum(ob.outstanding) filter (where ob.bucket = '0_30'), 0)::numeric(18,2) as bucket_0_30,
      coalesce(sum(ob.outstanding) filter (where ob.bucket = '31_60'), 0)::numeric(18,2) as bucket_31_60,
      coalesce(sum(ob.outstanding) filter (where ob.bucket = '61_90'), 0)::numeric(18,2) as bucket_61_90,
      coalesce(sum(ob.outstanding) filter (where ob.bucket = '90_plus'), 0)::numeric(18,2) as bucket_90_plus,
      coalesce(sum(ob.outstanding), 0)::numeric(18,2) as total
    from open_bills ob
    group by ob.supplier_id, ob.supplier_name
  ),
  totals as (
    select
      null::uuid, 'TOTALS'::text, true,
      coalesce(sum(ps.bucket_current), 0)::numeric(18,2),
      coalesce(sum(ps.bucket_0_30), 0)::numeric(18,2),
      coalesce(sum(ps.bucket_31_60), 0)::numeric(18,2),
      coalesce(sum(ps.bucket_61_90), 0)::numeric(18,2),
      coalesce(sum(ps.bucket_90_plus), 0)::numeric(18,2),
      coalesce(sum(ps.total), 0)::numeric(18,2)
    from per_supplier ps
  )
  select * from per_supplier
  union all
  select * from totals;
end;
$$;
revoke all on function get_aged_payables(uuid, date) from public;
revoke all on function get_aged_payables(uuid, date) from authenticated;
revoke all on function get_aged_payables(uuid, date) from anon;
grant execute on function get_aged_payables(uuid, date) to service_role;

create or replace function get_bills_due(
  p_company_id uuid,
  p_as_of_date date
)
returns table (
  bill_id uuid,
  supplier_id uuid,
  supplier_name text,
  bill_number text,
  due_date date,
  scheduled_payment_date date,
  match_status bill_match_status,
  outstanding numeric(18,2)
)
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
begin
  if p_company_id is null then raise exception 'COMPANY_ID_REQUIRED'; end if;
  if p_as_of_date is null then raise exception 'AS_OF_DATE_REQUIRED'; end if;
  return query
  select
    b.id, b.supplier_id, s.supplier_name, b.bill_number, b.due_date,
    b.scheduled_payment_date, b.match_status,
    (b.grand_total - b.amount_paid)::numeric(18,2)
  from bills b
  join suppliers s on s.id = b.supplier_id
  where b.company_id = p_company_id
    and b.status in ('issued', 'partially_paid')
    and b.amount_paid < b.grand_total
    and b.journal_entry_id is not null
  order by b.due_date nulls last, b.bill_number;
end;
$$;
revoke all on function get_bills_due(uuid, date) from public;
revoke all on function get_bills_due(uuid, date) from authenticated;
revoke all on function get_bills_due(uuid, date) from anon;
grant execute on function get_bills_due(uuid, date) to service_role;

create or replace function reconcile_supplier_statement(
  p_company_id uuid,
  p_supplier_id uuid,
  p_statement_date date
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
declare
  v_matched jsonb;
  v_ours jsonb;
  v_theirs jsonb;
begin
  if p_company_id is null then raise exception 'COMPANY_ID_REQUIRED'; end if;
  if p_supplier_id is null then raise exception 'SUPPLIER_ID_REQUIRED'; end if;
  if p_statement_date is null then raise exception 'STATEMENT_DATE_REQUIRED'; end if;

  select coalesce(jsonb_agg(to_jsonb(ssl) order by ssl.line_date), '[]'::jsonb)
    into v_matched
    from supplier_statement_lines ssl
   where ssl.company_id = p_company_id
     and ssl.supplier_id = p_supplier_id
     and ssl.statement_date = p_statement_date
     and ssl.match_status = 'matched';

  select coalesce(jsonb_agg(x order by x->>'date'), '[]'::jsonb)
    into v_ours
    from (
      select jsonb_build_object(
        'kind', 'bill', 'id', b.id, 'date', b.bill_date,
        'reference', b.supplier_invoice_number, 'amount', b.grand_total
      ) as x
      from bills b
      where b.company_id = p_company_id
        and b.supplier_id = p_supplier_id
        and b.journal_entry_id is not null
        and b.status <> 'void'
        and not exists (
          select 1 from supplier_statement_lines ssl
           where ssl.matched_bill_id = b.id
             and ssl.statement_date = p_statement_date
        )
      union all
      select jsonb_build_object(
        'kind', 'payment', 'id', sp.id, 'date', sp.payment_date,
        'reference', sp.reference_number, 'amount', sp.amount
      )
      from supplier_payments sp
      where sp.company_id = p_company_id
        and sp.supplier_id = p_supplier_id
        and sp.journal_entry_id is not null
        and not exists (
          select 1 from supplier_statement_lines ssl
           where ssl.matched_payment_id = sp.id
             and ssl.statement_date = p_statement_date
        )
    ) q;

  select coalesce(jsonb_agg(to_jsonb(ssl) || jsonb_build_object(
    'suggested_bill_id', (
      select b.id from bills b
       where b.company_id = ssl.company_id
         and b.supplier_id = ssl.supplier_id
         and b.journal_entry_id is not null
         and b.status <> 'void'
         and b.grand_total = ssl.amount
         and (
           (ssl.reference is not null and btrim(ssl.reference) <> '' and b.supplier_invoice_number = ssl.reference)
           or abs(b.bill_date - ssl.line_date) <= 7
         )
       order by case when b.supplier_invoice_number = ssl.reference then 0 else 1 end,
                abs(b.bill_date - ssl.line_date)
       limit 1
    ),
    'suggested_payment_id', (
      select sp.id from supplier_payments sp
       where sp.company_id = ssl.company_id
         and sp.supplier_id = ssl.supplier_id
         and sp.journal_entry_id is not null
         and sp.amount = ssl.amount
         and (
           (ssl.reference is not null and btrim(ssl.reference) <> '' and sp.reference_number = ssl.reference)
           or abs(sp.payment_date - ssl.line_date) <= 7
         )
       order by case when sp.reference_number = ssl.reference then 0 else 1 end,
                abs(sp.payment_date - ssl.line_date)
       limit 1
    )
  ) order by ssl.line_date), '[]'::jsonb)
    into v_theirs
    from supplier_statement_lines ssl
   where ssl.company_id = p_company_id
     and ssl.supplier_id = p_supplier_id
     and ssl.statement_date = p_statement_date
     and ssl.match_status <> 'matched';

  return jsonb_build_object(
    'matched', coalesce(v_matched, '[]'::jsonb),
    'unmatched_ours', coalesce(v_ours, '[]'::jsonb),
    'unmatched_theirs', coalesce(v_theirs, '[]'::jsonb)
  );
end;
$$;
revoke all on function reconcile_supplier_statement(uuid, uuid, date) from public;
revoke all on function reconcile_supplier_statement(uuid, uuid, date) from authenticated;
revoke all on function reconcile_supplier_statement(uuid, uuid, date) from anon;
grant execute on function reconcile_supplier_statement(uuid, uuid, date) to service_role;



-- ============================================================================
-- Module 1.1.F — UAE VAT (5%) Compliance Engine
-- [feature-spec-1_1_F.md §3 / F-1…F-44]
-- ============================================================================

create table vat_tax_rule_versions (
  id                    uuid primary key default gen_random_uuid(),
  standard_rate         numeric(5,2) not null,
  cas_threshold         numeric(18,2) not null default 5000000,
  vd_amount_threshold   numeric(18,2) not null default 10000,
  effective_from        date not null unique,
  notes                 text,
  created_at            timestamptz not null default now()
);

insert into vat_tax_rule_versions (standard_rate, cas_threshold, vd_amount_threshold, effective_from, notes)
values (5.00, 5000000, 10000, '2018-01-01', 'Federal Decree-Law No. 8 of 2017 as cited on COA 1400');

create table vat_return_box_definitions (
  id              uuid primary key default gen_random_uuid(),
  group_key       text not null,
  fta_box_code    text,
  fta_box_label   text not null,
  effective_from  date not null,
  unique (group_key, effective_from)
);

-- [feature-spec-1_1_F.md F-42] boxes 1, 3–14; Box 2 and CAS box stay null.
insert into vat_return_box_definitions (group_key, fta_box_code, fta_box_label, effective_from) values
  ('out_standard_rated', '1', 'Standard-rated supplies (by Emirate)', '2018-01-01'),
  ('out_reverse_charge', '3', 'Supplies subject to reverse charge', '2018-01-01'),
  ('out_zero_rated', '4', 'Zero-rated supplies', '2018-01-01'),
  ('out_exempt', '5', 'Exempt supplies', '2018-01-01'),
  ('in_imports_customs', '6', 'Goods imported into UAE (FTA auto-fills from customs/TRN)', '2018-01-01'),
  ('in_import_adjustments', '7', 'Adjustments to imported goods', '2018-01-01'),
  ('out_total_output_tax', '8', 'Total output tax', '2018-01-01'),
  ('in_standard_rated', '9', 'Standard-rated expenses (recoverable input tax)', '2018-01-01'),
  ('in_reverse_charge', '10', 'Imports subject to reverse charge (input side)', '2018-01-01'),
  ('in_total_input_tax', '11', 'Total input tax', '2018-01-01'),
  ('total_payable_tax', '12', 'Total payable tax', '2018-01-01'),
  ('total_recoverable_tax', '13', 'Total recoverable tax', '2018-01-01'),
  ('net_payable', '14', 'Net VAT payable / refundable', '2018-01-01'),
  ('out_out_of_scope', null, 'Out-of-scope supplies (disclosure)', '2018-01-01'),
  ('out_designated_zone', null, 'Designated-zone supplies (disclosure until screenshot)', '2018-01-01'),
  ('out_bad_debt_relief', null, 'Bad debt relief (reduces output)', '2018-01-01'),
  ('in_blocked', null, 'Blocked / non-recoverable input VAT', '2018-01-01'),
  ('in_apportionment', null, 'Partial-exemption apportionment slice', '2018-01-01'),
  ('in_capital_goods', null, 'Capital Assets Scheme adjustments (screenshot-gated)', '2018-01-01');

create table vat_return_periods (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references companies(id),
  period_start                date not null,
  period_end                  date not null,
  status                      vat_return_status not null default 'draft',
  payment_due_date            date,
  refund_claim_status         vat_refund_claim_status not null default 'none',
  output_vat                  numeric(18,2) not null default 0,
  input_vat                   numeric(18,2) not null default 0,
  net_vat                     numeric(18,2) not null default 0,
  retention_until             date,
  settlement_journal_entry_id uuid references journal_entries(id),
  supersedes_period_id        uuid references vat_return_periods(id),
  calculated_at               timestamptz,
  calculated_by               uuid,
  reviewed_by                 uuid,
  reviewed_at                 timestamptz,
  approved_by                 uuid,
  approved_at                 timestamptz,
  filed_at                    timestamptz,
  filed_by                    uuid,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check (period_end > period_start)
);

create unique index vat_return_periods_company_start_active_uq
  on vat_return_periods (company_id, period_start)
  where status <> 'superseded';

create table vat_return_line_items (
  id            uuid primary key default gen_random_uuid(),
  period_id     uuid not null references vat_return_periods(id) on delete cascade,
  group_key     text not null,
  amount        numeric(18,2) not null default 0,
  fta_box_code  text,
  emirate       uae_emirate
);

create unique index vat_return_line_items_group_no_emirate_uq
  on vat_return_line_items (period_id, group_key) where emirate is null;
create unique index vat_return_line_items_group_emirate_uq
  on vat_return_line_items (period_id, group_key, emirate) where emirate is not null;

create table vat_return_line_item_sources (
  id                    uuid primary key default gen_random_uuid(),
  line_item_id          uuid not null references vat_return_line_items(id) on delete cascade,
  invoice_line_id       uuid references invoice_lines(id),
  credit_note_line_id   uuid references credit_note_lines(id),
  bill_line_id          uuid references bill_lines(id),
  journal_line_id       uuid references journal_lines(id),
  write_off_id          uuid references write_offs(id),
  amount                numeric(18,2) not null,
  constraint vat_return_line_item_sources_xor check (
    (invoice_line_id is not null)::int
    + (credit_note_line_id is not null)::int
    + (bill_line_id is not null)::int
    + (journal_line_id is not null)::int
    + (write_off_id is not null)::int = 1
  )
);

create table vat_apportionment_calculations (
  period_id        uuid primary key references vat_return_periods(id),
  taxable_output   numeric(18,2) not null,
  exempt_output    numeric(18,2) not null,
  recoverable_pct  numeric(9,6) not null,
  journal_entry_id uuid references journal_entries(id),
  calculated_at    timestamptz not null,
  calculated_by    uuid not null
);

create table capital_goods_projects (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id),
  description     text not null,
  asset_category  capital_asset_category not null,
  created_by      uuid not null,
  created_at      timestamptz not null default now()
);

create table capital_goods_items (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references companies(id),
  project_id               uuid references capital_goods_projects(id),
  description              text not null,
  acquisition_date         date not null,
  capital_value            numeric(18,2) not null check (capital_value > 0),
  initial_vat              numeric(18,2) not null,
  initial_recovery_pct     numeric(5,2) not null check (initial_recovery_pct between 0 and 100),
  adjustment_period_years  smallint not null check (adjustment_period_years in (5, 10)),
  period_override_reason   text,
  bill_line_id             uuid references bill_lines(id),
  created_by               uuid not null,
  created_at               timestamptz not null default now()
);

alter table bill_lines
  add constraint bill_lines_capital_goods_project_id_fkey
  foreign key (capital_goods_project_id) references capital_goods_projects(id);

create table capital_goods_adjustments (
  id                 uuid primary key default gen_random_uuid(),
  item_id            uuid not null references capital_goods_items(id),
  fiscal_year        integer not null,
  actual_use_pct     numeric(5,2) not null check (actual_use_pct between 0 and 100),
  adjustment_amount  numeric(18,2) not null,
  journal_entry_id   uuid references journal_entries(id),
  created_by         uuid not null,
  created_at         timestamptz not null default now(),
  unique (item_id, fiscal_year)
);

create table vat_bad_debt_relief_claims (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id),
  write_off_id         uuid not null references write_offs(id) unique,
  vat_amount           numeric(18,2) not null check (vat_amount > 0),
  status               vat_relief_claim_status not null default 'pending_eligible',
  vat_return_period_id uuid references vat_return_periods(id),
  journal_entry_id     uuid references journal_entries(id),
  claimed_at           timestamptz,
  created_at           timestamptz not null default now()
);

create table vat_voluntary_disclosures (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id),
  original_period_id uuid not null references vat_return_periods(id),
  error_description  text not null,
  corrected_figures  jsonb not null,
  delta_net_vat      numeric(18,2) not null,
  path               vat_correction_path not null default 'voluntary_disclosure',
  emirate_mismatch   boolean not null default false,
  discovered_at      date not null,
  due_by             date not null,
  status             text not null default 'draft'
    check (status in ('draft', 'approved')),
  approved_by        uuid,
  approved_at        timestamptz,
  created_by         uuid not null,
  created_at         timestamptz not null default now()
);

create table vat_period_corrections (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id),
  original_period_id   uuid not null references vat_return_periods(id),
  correction_period_id uuid not null references vat_return_periods(id),
  delta_net_vat        numeric(18,2) not null,
  journal_entry_id     uuid references journal_entries(id),
  created_by           uuid not null,
  created_at           timestamptz not null default now(),
  check (correction_period_id <> original_period_id)
);

create table fta_filing_log (
  id                   uuid primary key default gen_random_uuid(),
  vat_return_period_id uuid not null references vat_return_periods(id),
  attempted_at         timestamptz not null default now(),
  adapter_status       text not null,
  adapter_response     jsonb,
  attempted_by         uuid not null
);

-- ============================================================================
-- MODULE G — UAE Corporate Tax (feature-spec-1_1_G.md §3)
-- ============================================================================

-- [feature-spec-1_1_G.md §3.3 / G-10] Versioned CT rates. No company_id — same
-- posture as vat_tax_rule_versions (global rule row, not tenant data).
create table ct_tax_rule_versions (
  id                        uuid primary key default gen_random_uuid(),
  effective_from            date not null unique,
  standard_rate             numeric(5,2) not null,
  zero_rate_threshold       numeric(18,2) not null,
  qfzp_rate                 numeric(5,2) not null,
  qfzp_deminimis_pct        numeric(5,2) not null default 5,
  qfzp_deminimis_cap        numeric(18,2) not null,
  sbr_revenue_cap           numeric(18,2) not null,
  sbr_eligible_through      date not null,
  entertainment_addback_pct numeric(5,2) not null default 50,
  other_addback_accounts    text[] not null default '{5810,5930}',
  alert_threshold_pct       numeric(5,2) not null default 90,
  notes                     text,
  created_at                timestamptz not null default now()
);

-- [feature-spec-1_1_G.md §3.3 seed] Field values G-15/G-16/G-17/G-18 / G-40 / §4.2.
-- [feature-spec-1_1_G.md G-40] effective_from 2023-06-01 is rate commencement
-- (FY starting on or after 1 June 2023), not Decree-Law 47/2022 enactment.
insert into ct_tax_rule_versions (
  effective_from, standard_rate, zero_rate_threshold, qfzp_rate,
  qfzp_deminimis_pct, qfzp_deminimis_cap, sbr_revenue_cap, sbr_eligible_through,
  entertainment_addback_pct, other_addback_accounts, alert_threshold_pct, notes
) values (
  '2023-06-01', 9.00, 375000, 0.00,
  5.00, 5000000, 3000000, '2026-12-31',
  50.00, '{5810,5930}', 90.00,
  'Federal Decree-Law No. 47 of 2022 as cited for Module G seed (G-10)'
);

-- [feature-spec-1_1_G.md §3.4 / G-25 / G-32]
create table ct_income_adjustments (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id),
  fiscal_year      integer not null,
  adjustment_type  ct_income_adjustment_type not null,
  amount           numeric(18,2) not null,
  invoice_line_id  uuid references invoice_lines(id),
  journal_line_id  uuid references journal_lines(id),
  journal_entry_id uuid references journal_entries(id),
  recorded_at      timestamptz not null default now(),
  recorded_by      uuid,
  constraint ct_income_adjustments_source_xor check (
    (
      adjustment_type in ('qualifying_dividend', 'intragroup_transaction')
      and (invoice_line_id is not null)::int
        + (journal_line_id is not null)::int
        + (journal_entry_id is not null)::int = 1
    )
    or (
      adjustment_type in ('non_deductible_entertainment', 'non_deductible_other')
      and invoice_line_id is null
      and journal_line_id is null
      and journal_entry_id is null
    )
  )
);

create index idx_ct_income_adjustments_company_fy
  on ct_income_adjustments (company_id, fiscal_year);

-- [feature-spec-1_1_G.md §3.5 / G-1 / G-13 / G-19 / G-22 / G-41]
create table ct_provision_entries (
  id                         uuid primary key default gen_random_uuid(),
  company_id                 uuid not null references companies(id),
  fiscal_year                integer not null,
  taxable_profit_estimate    numeric(18,2) not null,
  is_qfzp_calculation        boolean not null default false,
  sbr_eligible               boolean not null default false,
  ct_due                     numeric(18,2) not null,
  payment_due_date           date not null,
  status                     ct_provision_status not null default 'draft',
  provision_journal_entry_id uuid references journal_entries(id),
  posted_at                  timestamptz,
  posted_by                  uuid,
  unique (company_id, fiscal_year),
  constraint ct_provision_entries_status_je_check check (
    (
      status = 'posted'
      and provision_journal_entry_id is not null
    )
    or (
      status = 'posted_nil'
      and provision_journal_entry_id is null
      and ct_due = 0
    )
    or (
      status not in ('posted', 'posted_nil')
    )
  )
);

-- [feature-spec-1_1_G.md §3.6 / G-7 / G-26]
create table related_party_transactions (
  id                           uuid primary key default gen_random_uuid(),
  company_id                   uuid not null references companies(id),
  counterparty_name            text not null,
  relationship                 related_party_relationship not null,
  transaction_type             text not null,
  amount                       numeric(18,2) not null,
  transaction_date             date not null,
  reference_journal_entry_id   uuid references journal_entries(id),
  notes                        text,
  created_at                   timestamptz not null default now()
);

create index idx_related_party_transactions_company
  on related_party_transactions (company_id, transaction_date desc);

create or replace view vat_invoice_register
  with (security_invoker = true)
as
select
  i.company_id,
  i.id as invoice_id,
  i.invoice_number,
  i.status,
  i.invoice_date,
  i.grand_total,
  extract(year from i.invoice_date)::int as register_year,
  (
    lag(
      nullif(regexp_replace(i.invoice_number, '^INV-[0-9]+-', ''), i.invoice_number)::int
    ) over (
      partition by i.company_id, extract(year from i.invoice_date)
      order by nullif(regexp_replace(i.invoice_number, '^INV-[0-9]+-', ''), i.invoice_number)::int
    )
    is distinct from
    nullif(regexp_replace(i.invoice_number, '^INV-[0-9]+-', ''), i.invoice_number)::int - 1
    and lag(i.id) over (
      partition by i.company_id, extract(year from i.invoice_date)
      order by nullif(regexp_replace(i.invoice_number, '^INV-[0-9]+-', ''), i.invoice_number)::int
    ) is not null
  ) as gap_before
from invoices i
where i.invoice_number is not null;

create or replace function effective_vat_standard_rate(p_on_date date)
returns numeric(5,2)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rate numeric(5,2);
begin
  -- [feature-spec-1_1_F.md F-23] do not hardcode 5% in F RPCs.
  select standard_rate into v_rate
    from vat_tax_rule_versions
   where effective_from <= coalesce(p_on_date, current_date)
   order by effective_from desc
   limit 1;
  if v_rate is null then
    raise exception 'VAT_TAX_RULE_NOT_FOUND';
  end if;
  return v_rate;
end;
$$;
revoke all on function effective_vat_standard_rate(date) from public;
revoke all on function effective_vat_standard_rate(date) from authenticated;
revoke all on function effective_vat_standard_rate(date) from anon;
grant execute on function effective_vat_standard_rate(date) to service_role;

create or replace function effective_vat_tax_rules(p_on_date date)
returns vat_tax_rule_versions
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row vat_tax_rule_versions%rowtype;
begin
  select * into v_row
    from vat_tax_rule_versions
   where effective_from <= coalesce(p_on_date, current_date)
   order by effective_from desc
   limit 1;
  if not found then
    raise exception 'VAT_TAX_RULE_NOT_FOUND';
  end if;
  return v_row;
end;
$$;
revoke all on function effective_vat_tax_rules(date) from public;
revoke all on function effective_vat_tax_rules(date) from authenticated;
revoke all on function effective_vat_tax_rules(date) from anon;
grant execute on function effective_vat_tax_rules(date) to service_role;

create or replace function assert_not_filed_vat_period(
  p_company_id uuid,
  p_tax_point date,
  p_hits_vat_accounts boolean,
  p_is_sales_or_purchase_document boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- [feature-spec-1_1_F.md F-38]
  if not coalesce(p_hits_vat_accounts, false)
     and not coalesce(p_is_sales_or_purchase_document, false) then
    return;
  end if;
  if exists (
    select 1 from vat_return_periods
     where company_id = p_company_id
       and status = 'filed'
       and period_start <= p_tax_point
       and period_end > p_tax_point
  ) then
    raise exception 'VAT_PERIOD_FILED';
  end if;
end;
$$;
revoke all on function assert_not_filed_vat_period(uuid, date, boolean, boolean) from public;
revoke all on function assert_not_filed_vat_period(uuid, date, boolean, boolean) from authenticated;
revoke all on function assert_not_filed_vat_period(uuid, date, boolean, boolean) from anon;
grant execute on function assert_not_filed_vat_period(uuid, date, boolean, boolean) to service_role;

create or replace function journal_hits_vat_accounts(p_entry_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  return exists (
    select 1
      from journal_lines jl
      join accounts a on a.id = jl.account_id
     where jl.journal_entry_id = p_entry_id
       and a.account_number in (
         '1400','1410','1415','1420','2200','2210','2230','5580','5800','5641'
       )
  );
end;
$$;
revoke all on function journal_hits_vat_accounts(uuid) from public;
revoke all on function journal_hits_vat_accounts(uuid) from authenticated;
revoke all on function journal_hits_vat_accounts(uuid) from anon;
grant execute on function journal_hits_vat_accounts(uuid) to service_role;

create or replace function assert_vat_period_on_journal_post()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('posted', 'pending_approval')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform assert_not_filed_vat_period(
      new.company_id,
      new.entry_date,
      journal_hits_vat_accounts(new.id),
      false
    );
  end if;
  return new;
end;
$$;

create trigger trg_assert_vat_period_on_journal_post
  before insert or update on journal_entries
  for each row execute function assert_vat_period_on_journal_post();

create or replace function prevent_filed_vat_return_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- [feature-spec-1_1_F.md F-14] filed rows append-only except F-12 supersede.
  if old.status = 'filed' then
    if tg_op = 'DELETE' then
      raise exception 'VAT_RETURN_FILED_IMMUTABLE';
    end if;
    if new.status = 'superseded' then
      return new;
    end if;
    if new.status is distinct from old.status
       or new.output_vat is distinct from old.output_vat
       or new.input_vat is distinct from old.input_vat
       or new.net_vat is distinct from old.net_vat then
      raise exception 'VAT_RETURN_FILED_IMMUTABLE';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_prevent_filed_vat_return_mutation
  before update or delete on vat_return_periods
  for each row execute function prevent_filed_vat_return_mutation();

create or replace function line_net_amount(
  p_quantity numeric,
  p_unit_price numeric,
  p_discount_percent numeric,
  p_discount_amount numeric
)
returns numeric(18,2)
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_gross numeric(18,2);
  v_discount numeric(18,2);
begin
  v_gross := round(p_quantity * p_unit_price, 2);
  if p_discount_percent is not null then
    v_discount := round(v_gross * p_discount_percent / 100, 2);
  else
    v_discount := coalesce(p_discount_amount, 0);
  end if;
  return v_gross - v_discount;
end;
$$;

create or replace function suggest_sales_line_vat_fields()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_rate numeric(5,2);
  v_default uae_emirate;
begin
  -- [feature-spec-1_1_F.md F-19 / F-43]
  if tg_table_name = 'invoice_lines' then
    select company_id into v_company_id from invoices where id = new.invoice_id;
  elsif tg_table_name = 'quotation_lines' then
    select company_id into v_company_id from quotations where id = new.quotation_id;
  elsif tg_table_name = 'credit_note_lines' then
    select company_id into v_company_id from credit_notes where id = new.credit_note_id;
  end if;

  if new.vat_category is null then
    v_rate := effective_vat_standard_rate(current_date);
    if new.vat_rate = v_rate then
      new.vat_category := 'standard_rated';
    elsif new.vat_rate = 0 then
      new.vat_category := 'zero_rated';
    else
      new.vat_category := 'exempt';
    end if;
  end if;

  if new.emirate is null and v_company_id is not null then
    select default_emirate into v_default
      from company_settings where company_id = v_company_id;
    new.emirate := v_default;
  end if;
  return new;
end;
$$;

create trigger trg_suggest_invoice_line_vat_fields
  before insert or update on invoice_lines
  for each row execute function suggest_sales_line_vat_fields();
create trigger trg_suggest_quotation_line_vat_fields
  before insert or update on quotation_lines
  for each row execute function suggest_sales_line_vat_fields();
create trigger trg_suggest_credit_note_line_vat_fields
  before insert or update on credit_note_lines
  for each row execute function suggest_sales_line_vat_fields();

create or replace function suggest_bill_line_vat_fields()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_rate numeric(5,2);
begin
  -- [feature-spec-1_1_F.md F-19] 5% → standard_rated; non-5 left null (do not guess).
  if new.vat_category is null then
    v_rate := effective_vat_standard_rate(current_date);
    if new.vat_rate = v_rate then
      new.vat_category := 'standard_rated';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_suggest_bill_line_vat_fields
  before insert or update on bill_lines
  for each row execute function suggest_bill_line_vat_fields();

create or replace function assert_invoice_vat_ready(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice invoices%rowtype;
  v_line record;
  v_rate numeric(5,2);
begin
  select * into v_invoice from invoices where id = p_invoice_id;
  v_rate := effective_vat_standard_rate(v_invoice.invoice_date);
  for v_line in select * from invoice_lines where invoice_id = p_invoice_id
  loop
    if v_line.vat_category is null then
      raise exception 'INVOICE_LINE_MISSING_VAT_CATEGORY';
    end if;
    if v_line.vat_category = 'standard_rated' then
      if v_line.vat_rate <> v_rate then
        raise exception 'VAT_RATE_CATEGORY_MISMATCH';
      end if;
      if v_line.emirate is null then
        raise exception 'INVOICE_LINE_MISSING_EMIRATE';
      end if;
    elsif v_line.vat_rate <> 0 then
      raise exception 'VAT_RATE_CATEGORY_MISMATCH';
    end if;
  end loop;
end;
$$;
revoke all on function assert_invoice_vat_ready(uuid) from public;
revoke all on function assert_invoice_vat_ready(uuid) from authenticated;
revoke all on function assert_invoice_vat_ready(uuid) from anon;
grant execute on function assert_invoice_vat_ready(uuid) to service_role;

create or replace function assert_credit_note_vat_ready(p_credit_note_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cn credit_notes%rowtype;
  v_line record;
  v_rate numeric(5,2);
begin
  select * into v_cn from credit_notes where id = p_credit_note_id;
  v_rate := effective_vat_standard_rate(v_cn.credit_note_date);
  for v_line in select * from credit_note_lines where credit_note_id = p_credit_note_id
  loop
    if v_line.vat_category is null then
      raise exception 'CREDIT_NOTE_LINE_MISSING_VAT_CATEGORY';
    end if;
    if v_line.vat_category = 'standard_rated' then
      if v_line.vat_rate <> v_rate then
        raise exception 'VAT_RATE_CATEGORY_MISMATCH';
      end if;
      if v_line.emirate is null then
        raise exception 'INVOICE_LINE_MISSING_EMIRATE';
      end if;
    elsif v_line.vat_rate <> 0 then
      raise exception 'VAT_RATE_CATEGORY_MISMATCH';
    end if;
  end loop;
end;
$$;
revoke all on function assert_credit_note_vat_ready(uuid) from public;
revoke all on function assert_credit_note_vat_ready(uuid) from authenticated;
revoke all on function assert_credit_note_vat_ready(uuid) from anon;
grant execute on function assert_credit_note_vat_ready(uuid) to service_role;

create or replace function assert_bill_vat_ready(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bill bills%rowtype;
  v_line record;
  v_rate numeric(5,2);
  v_treatment vat_input_treatment;
begin
  select * into v_bill from bills where id = p_bill_id;
  v_rate := effective_vat_standard_rate(v_bill.bill_date);
  for v_line in select * from bill_lines where bill_id = p_bill_id
  loop
    if v_line.vat_category is null then
      raise exception 'BILL_LINE_MISSING_VAT_CATEGORY';
    end if;
    v_treatment := v_line.vat_input_treatment;
    if v_treatment is null and v_line.vat_category = 'standard_rated' then
      v_treatment := 'recoverable';
      update bill_lines set vat_input_treatment = 'recoverable' where id = v_line.id;
    end if;
    if v_treatment = 'reverse_charge' then
      if v_line.vat_category <> 'standard_rated' or v_line.vat_rate <> 0 then
        raise exception 'VAT_RATE_CATEGORY_MISMATCH';
      end if;
    elsif v_line.vat_category = 'standard_rated' then
      if v_line.vat_rate <> v_rate then
        raise exception 'VAT_RATE_CATEGORY_MISMATCH';
      end if;
    elsif v_line.vat_rate <> 0 then
      raise exception 'VAT_RATE_CATEGORY_MISMATCH';
    end if;
  end loop;
end;
$$;
revoke all on function assert_bill_vat_ready(uuid) from public;
revoke all on function assert_bill_vat_ready(uuid) from authenticated;
revoke all on function assert_bill_vat_ready(uuid) from anon;
grant execute on function assert_bill_vat_ready(uuid) to service_role;

-- F-19 backfill of already-issued sales lines (drafts stay nullable until Issue).
update invoice_lines il
   set vat_category = case
     when il.vat_rate = 5 then 'standard_rated'::vat_category
     when exists (
       select 1 from accounts a where a.id = il.income_account_id and a.account_number = '4020'
     ) then 'exempt'::vat_category
     when exists (
       select 1 from accounts a where a.id = il.income_account_id and a.account_number = '4030'
     ) then 'designated_zone'::vat_category
     when il.vat_rate = 0 then 'zero_rated'::vat_category
     else il.vat_category
   end
 where il.vat_category is null
   and exists (
     select 1 from invoices i where i.id = il.invoice_id and i.status <> 'draft'
   );

update bill_lines bl
   set vat_category = 'standard_rated'
 where bl.vat_category is null
   and bl.vat_rate = 5
   and exists (
     select 1 from bills b where b.id = bl.bill_id and b.status not in ('draft', 'matched')
   );


create or replace function vat_period_bounds(
  p_company_id uuid,
  p_period_start date,
  out o_start date,
  out o_end date
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_freq text;
  v_fy_month smallint;
  v_month int;
  v_offset int;
begin
  -- [feature-spec-1_1_F.md F-29]
  select cs.vat_return_frequency, c.fiscal_year_start_month
    into v_freq, v_fy_month
    from company_settings cs
    join companies c on c.id = cs.company_id
   where cs.company_id = p_company_id;
  if v_freq is null then
    v_freq := 'quarterly';
    v_fy_month := 1;
  end if;
  if v_freq = 'monthly' then
    o_start := date_trunc('month', p_period_start)::date;
    o_end := (o_start + interval '1 month')::date;
  else
    v_month := extract(month from p_period_start)::int;
    v_offset := ((v_month - v_fy_month) % 12 + 12) % 12;
    o_start := make_date(
      extract(year from p_period_start)::int,
      extract(month from p_period_start)::int,
      1
    ) - (v_offset % 3) * interval '1 month';
    o_start := o_start::date;
    o_end := (o_start + interval '3 months')::date;
  end if;
end;
$$;
revoke all on function vat_period_bounds(uuid, date) from public;
revoke all on function vat_period_bounds(uuid, date) from authenticated;
revoke all on function vat_period_bounds(uuid, date) from anon;
grant execute on function vat_period_bounds(uuid, date) to service_role;

create or replace function vat_payment_due_date(p_period_end date)
returns date
language sql
immutable
as $$
  -- [feature-spec-1_1_F.md F-21] 28th of month after last inclusive day (period_end exclusive).
  select make_date(
    extract(year from (p_period_end - 1 + interval '1 month'))::int,
    extract(month from (p_period_end - 1 + interval '1 month'))::int,
    28
  );
$$;
revoke all on function vat_payment_due_date(date) from public;
revoke all on function vat_payment_due_date(date) from authenticated;
revoke all on function vat_payment_due_date(date) from anon;
grant execute on function vat_payment_due_date(date) to service_role;

create or replace function account_id_by_number(p_company_id uuid, p_number char(4), p_require_active boolean default true)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select id into v_id
    from accounts
   where company_id = p_company_id
     and account_number = p_number
     and (not p_require_active or is_active = true);
  return v_id;
end;
$$;
revoke all on function account_id_by_number(uuid, char, boolean) from public;
revoke all on function account_id_by_number(uuid, char, boolean) from authenticated;
revoke all on function account_id_by_number(uuid, char, boolean) from anon;
grant execute on function account_id_by_number(uuid, char, boolean) to service_role;

create or replace function post_vat_journal_entry(
  p_company_id uuid,
  p_entry_date date,
  p_entry_type journal_entry_type,
  p_narration text,
  p_created_by uuid,
  p_lines jsonb,
  p_reference_number text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period accounting_periods%rowtype;
  v_entry journal_entries%rowtype;
  v_entry_number bigint;
  v_line jsonb;
  v_n int := 0;
  v_account uuid;
  v_debit numeric(18,2);
  v_credit numeric(18,2);
begin
  if p_created_by is null then
    raise exception 'CREATED_BY_REQUIRED';
  end if;
  select * into v_period
    from accounting_periods
   where company_id = p_company_id
     and status = 'open'
     and period_start <= p_entry_date
     and period_end > p_entry_date
   order by period_start
   limit 1;
  if not found then
    raise exception 'NO_OPEN_PERIOD_FOR_DATE';
  end if;
  v_entry_number := allocate_next_entry_number(p_company_id);
  insert into journal_entries (
    company_id, entry_number, period_id, entry_date, entry_type, status,
    narration, reference_number, created_by
  ) values (
    p_company_id, v_entry_number, v_period.id, p_entry_date, p_entry_type, 'draft',
    p_narration, p_reference_number, p_created_by
  ) returning * into v_entry;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_account := account_id_by_number(p_company_id, (v_line->>'account_number')::char(4), true);
    if v_account is null then
      raise exception 'VAT_POSTING_ACCOUNT_NOT_FOUND';
    end if;
    v_debit := coalesce((v_line->>'debit')::numeric, 0);
    v_credit := coalesce((v_line->>'credit')::numeric, 0);
    if v_debit = 0 and v_credit = 0 then
      continue;
    end if;
    v_n := v_n + 1;
    insert into journal_lines (journal_entry_id, line_number, account_id, debit, credit, description)
    values (v_entry.id, v_n, v_account, v_debit, v_credit, v_line->>'description');
  end loop;

  update journal_entries
     set status = 'posted'
   where id = v_entry.id and status = 'draft'
  returning * into v_entry;
  if not found then
    raise exception 'Failed to post VAT journal entry %', v_entry_number;
  end if;
  return v_entry.id;
end;
$$;
revoke all on function post_vat_journal_entry(uuid, date, journal_entry_type, text, uuid, jsonb, text) from public;
revoke all on function post_vat_journal_entry(uuid, date, journal_entry_type, text, uuid, jsonb, text) from authenticated;
revoke all on function post_vat_journal_entry(uuid, date, journal_entry_type, text, uuid, jsonb, text) from anon;
grant execute on function post_vat_journal_entry(uuid, date, journal_entry_type, text, uuid, jsonb, text) to service_role;

create or replace function upsert_vat_group(
  p_period_id uuid,
  p_group_key text,
  p_amount numeric,
  p_emirate uae_emirate default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_box text;
begin
  select fta_box_code into v_box
    from vat_return_box_definitions
   where group_key = p_group_key
     and effective_from <= current_date
   order by effective_from desc
   limit 1;

  select id into v_id
    from vat_return_line_items
   where period_id = p_period_id
     and group_key = p_group_key
     and emirate is not distinct from p_emirate;
  if found then
    update vat_return_line_items
       set amount = amount + coalesce(p_amount, 0)
     where id = v_id;
  else
    insert into vat_return_line_items (period_id, group_key, amount, fta_box_code, emirate)
    values (p_period_id, p_group_key, coalesce(p_amount, 0), v_box, p_emirate)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function upsert_vat_group(uuid, text, numeric, uae_emirate) from public;
revoke all on function upsert_vat_group(uuid, text, numeric, uae_emirate) from authenticated;
revoke all on function upsert_vat_group(uuid, text, numeric, uae_emirate) from anon;
grant execute on function upsert_vat_group(uuid, text, numeric, uae_emirate) to service_role;

create or replace function calculate_vat_return(
  p_company_id uuid,
  p_period_start date,
  p_actor_id uuid
)
returns vat_return_periods
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_start date;
  v_end date;
  v_period vat_return_periods%rowtype;
  v_item uuid;
  v_rec record;
  v_net numeric(18,2);
  v_vat numeric(18,2);
  v_out numeric(18,2) := 0;
  v_in numeric(18,2) := 0;
  v_retention interval := interval '5 years';
begin
  if p_company_id is null or p_period_start is null or p_actor_id is null then
    raise exception 'CREATED_BY_REQUIRED';
  end if;
  -- [feature-spec-1_1_F.md F-7 / F-24] lock vat: then entry-number (inside post helper).
  perform pg_advisory_xact_lock(hashtext('vat:' || p_company_id::text));
  select * into v_start, v_end from vat_period_bounds(p_company_id, p_period_start);

  if exists (
    select 1 from invoice_lines il
    join invoices i on i.id = il.invoice_id
    where i.company_id = p_company_id
      and i.invoice_date >= v_start and i.invoice_date < v_end
      and i.status not in ('draft', 'void')
      and il.vat_category is null
  ) or exists (
    select 1 from bill_lines bl
    join bills b on b.id = bl.bill_id
    where b.company_id = p_company_id
      and b.bill_date >= v_start and b.bill_date < v_end
      and b.status not in ('draft', 'matched', 'void')
      and bl.vat_category is null
  ) then
    raise exception 'VAT_CATEGORY_UNBACKFILLED';
  end if;

  select * into v_period
    from vat_return_periods
   where company_id = p_company_id
     and period_start = v_start
     and status <> 'superseded'
   for update;
  if found then
    if v_period.status in ('approved', 'filed') then
      raise exception 'VAT_RETURN_LOCKED';
    end if;
    delete from vat_return_line_items where period_id = v_period.id;
  else
    insert into vat_return_periods (company_id, period_start, period_end)
    values (p_company_id, v_start, v_end)
    returning * into v_period;
  end if;

  -- Output standard-rated VAT by emirate (F-42 Box 1).
  for v_rec in
    select il.id, il.emirate,
           line_net_amount(il.quantity, il.unit_price, il.discount_percent, il.discount_amount) as net,
           il.vat_rate
      from invoice_lines il
      join invoices i on i.id = il.invoice_id
     where i.company_id = p_company_id
       and i.invoice_date >= v_start and i.invoice_date < v_end
       and i.status not in ('draft', 'void')
       and i.journal_entry_id is not null
       and is_ledger_truth_status((select status from journal_entries where id = i.journal_entry_id))
       and il.vat_category = 'standard_rated'
  loop
    v_vat := round(v_rec.net * v_rec.vat_rate / 100, 2);
    v_item := upsert_vat_group(v_period.id, 'out_standard_rated', v_vat, v_rec.emirate);
    insert into vat_return_line_item_sources (line_item_id, invoice_line_id, amount)
    values (v_item, v_rec.id, v_vat);
    v_out := v_out + v_vat;
  end loop;

  for v_rec in
    select cnl.id, cnl.emirate,
           line_net_amount(cnl.quantity, cnl.unit_price, cnl.discount_percent, cnl.discount_amount) as net,
           cnl.vat_rate
      from credit_note_lines cnl
      join credit_notes cn on cn.id = cnl.credit_note_id
     where cn.company_id = p_company_id
       and cn.credit_note_date >= v_start and cn.credit_note_date < v_end
       and cn.status not in ('draft', 'void')
       and cn.journal_entry_id is not null
       and is_ledger_truth_status((select status from journal_entries where id = cn.journal_entry_id))
       and cnl.vat_category = 'standard_rated'
  loop
    v_vat := round(v_rec.net * v_rec.vat_rate / 100, 2);
    v_item := upsert_vat_group(v_period.id, 'out_standard_rated', -v_vat, v_rec.emirate);
    insert into vat_return_line_item_sources (line_item_id, credit_note_line_id, amount)
    values (v_item, v_rec.id, -v_vat);
    v_out := v_out - v_vat;
  end loop;

  for v_rec in
    select il.id, il.vat_category,
           line_net_amount(il.quantity, il.unit_price, il.discount_percent, il.discount_amount) as net
      from invoice_lines il
      join invoices i on i.id = il.invoice_id
     where i.company_id = p_company_id
       and i.invoice_date >= v_start and i.invoice_date < v_end
       and i.status not in ('draft', 'void')
       and i.journal_entry_id is not null
       and is_ledger_truth_status((select status from journal_entries where id = i.journal_entry_id))
       and il.vat_category in ('zero_rated', 'exempt', 'out_of_scope', 'designated_zone')
  loop
    v_item := upsert_vat_group(
      v_period.id,
      case v_rec.vat_category
        when 'zero_rated' then 'out_zero_rated'
        when 'exempt' then 'out_exempt'
        when 'out_of_scope' then 'out_out_of_scope'
        else 'out_designated_zone'
      end,
      v_rec.net,
      null
    );
    insert into vat_return_line_item_sources (line_item_id, invoice_line_id, amount)
    values (v_item, v_rec.id, v_rec.net);
  end loop;

  -- RCM output (2210 credits) and input (1410).
  for v_rec in
    select bl.id,
           round(
             line_net_amount(bl.quantity, bl.unit_price, bl.discount_percent, bl.discount_amount)
             * effective_vat_standard_rate(b.bill_date) / 100, 2
           ) as rcm_vat
      from bill_lines bl
      join bills b on b.id = bl.bill_id
     where b.company_id = p_company_id
       and b.bill_date >= v_start and b.bill_date < v_end
       and b.status not in ('draft', 'matched', 'void')
       and b.journal_entry_id is not null
       and is_ledger_truth_status((select status from journal_entries where id = b.journal_entry_id))
       and bl.vat_input_treatment = 'reverse_charge'
  loop
    if v_rec.rcm_vat <> 0 then
      v_item := upsert_vat_group(v_period.id, 'out_reverse_charge', v_rec.rcm_vat, null);
      insert into vat_return_line_item_sources (line_item_id, bill_line_id, amount)
      values (v_item, v_rec.id, v_rec.rcm_vat);
      v_item := upsert_vat_group(v_period.id, 'in_reverse_charge', v_rec.rcm_vat, null);
      insert into vat_return_line_item_sources (line_item_id, bill_line_id, amount)
      values (v_item, v_rec.id, v_rec.rcm_vat);
      v_out := v_out + v_rec.rcm_vat;
      v_in := v_in + v_rec.rcm_vat;
    end if;
  end loop;

  -- Recoverable input (charged VAT on recoverable / mixed_use lines).
  for v_rec in
    select bl.id,
           round(
             line_net_amount(bl.quantity, bl.unit_price, bl.discount_percent, bl.discount_amount)
             * bl.vat_rate / 100, 2
           ) as input_vat,
           bl.vat_input_treatment
      from bill_lines bl
      join bills b on b.id = bl.bill_id
     where b.company_id = p_company_id
       and b.bill_date >= v_start and b.bill_date < v_end
       and b.status not in ('draft', 'matched', 'void')
       and b.journal_entry_id is not null
       and is_ledger_truth_status((select status from journal_entries where id = b.journal_entry_id))
       and bl.vat_category = 'standard_rated'
       and coalesce(bl.vat_input_treatment, 'recoverable') in ('recoverable', 'mixed_use')
  loop
    if v_rec.input_vat <> 0 then
      v_item := upsert_vat_group(v_period.id, 'in_standard_rated', v_rec.input_vat, null);
      insert into vat_return_line_item_sources (line_item_id, bill_line_id, amount)
      values (v_item, v_rec.id, v_rec.input_vat);
      v_in := v_in + v_rec.input_vat;
    end if;
  end loop;

  for v_rec in
    select c.id, c.vat_amount
      from vat_bad_debt_relief_claims c
     where c.company_id = p_company_id
       and c.status = 'claimed'
       and c.claimed_at >= v_start::timestamptz
       and c.claimed_at < v_end::timestamptz
  loop
    v_item := upsert_vat_group(v_period.id, 'out_bad_debt_relief', v_rec.vat_amount, null);
    insert into vat_return_line_item_sources (line_item_id, write_off_id, amount)
    values (v_item, (select write_off_id from vat_bad_debt_relief_claims where id = v_rec.id), v_rec.vat_amount);
    v_out := v_out - v_rec.vat_amount;
  end loop;

  perform upsert_vat_group(v_period.id, 'out_total_output_tax', v_out, null);
  perform upsert_vat_group(v_period.id, 'in_total_input_tax', v_in, null);
  perform upsert_vat_group(v_period.id, 'total_payable_tax', greatest(v_out, 0), null);
  perform upsert_vat_group(v_period.id, 'total_recoverable_tax', v_in, null);
  perform upsert_vat_group(v_period.id, 'net_payable', v_out - v_in, null);
  perform upsert_vat_group(v_period.id, 'in_imports_customs', 0, null);
  perform upsert_vat_group(v_period.id, 'in_import_adjustments', 0, null);

  if exists (
    select 1 from capital_goods_items cgi
    join capital_goods_projects cgp on cgp.id = cgi.project_id
     where cgi.company_id = p_company_id
       and cgp.asset_category = 'building_real_estate'
       and cgi.acquisition_date < v_end
  ) then
    v_retention := interval '15 years';
  elsif exists (
    select 1 from capital_goods_items cgi
     where cgi.company_id = p_company_id
       and cgi.acquisition_date < v_end
  ) then
    v_retention := interval '10 years';
  end if;

  update vat_return_periods
     set status = 'calculated',
         output_vat = v_out,
         input_vat = v_in,
         net_vat = v_out - v_in,
         payment_due_date = vat_payment_due_date(v_end),
         refund_claim_status = case when v_out - v_in < 0 then 'eligible'::vat_refund_claim_status else 'none'::vat_refund_claim_status end,
         retention_until = (v_end + v_retention)::date,
         calculated_at = now(),
         calculated_by = p_actor_id,
         updated_at = now()
   where id = v_period.id
  returning * into v_period;

  return v_period;
end;
$$;
revoke all on function calculate_vat_return(uuid, date, uuid) from public;
revoke all on function calculate_vat_return(uuid, date, uuid) from authenticated;
revoke all on function calculate_vat_return(uuid, date, uuid) from anon;
grant execute on function calculate_vat_return(uuid, date, uuid) to service_role;


create or replace function submit_vat_return_for_review(p_period_id uuid, p_actor_id uuid)
returns vat_return_periods
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period vat_return_periods%rowtype;
begin
  -- [feature-spec-1_1_F.md F-8] Accountant: calculated → under_review.
  select * into v_period from vat_return_periods where id = p_period_id for update;
  if not found then
    raise exception 'VAT_RETURN_NOT_FOUND';
  end if;
  if v_period.status <> 'calculated' then
    raise exception 'VAT_RETURN_NOT_CALCULATED';
  end if;
  update vat_return_periods
     set status = 'under_review', reviewed_by = p_actor_id, reviewed_at = now(), updated_at = now()
   where id = p_period_id
  returning * into v_period;
  return v_period;
end;
$$;
revoke all on function submit_vat_return_for_review(uuid, uuid) from public;
revoke all on function submit_vat_return_for_review(uuid, uuid) from authenticated;
revoke all on function submit_vat_return_for_review(uuid, uuid) from anon;
grant execute on function submit_vat_return_for_review(uuid, uuid) to service_role;

create or replace function reconcile_vat_return(p_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period vat_return_periods%rowtype;
  v_gl numeric(18,2);
  v_group numeric(18,2);
  v_var numeric(18,2);
  v_unexplained numeric(18,2) := 0;
  v_row jsonb := '[]'::jsonb;
  v_acc text;
begin
  -- [feature-spec-1_1_F.md F-17]
  select * into v_period from vat_return_periods where id = p_period_id;
  if not found then
    raise exception 'VAT_RETURN_NOT_FOUND';
  end if;

  foreach v_acc in array ARRAY['1400','1410','1415','1420','2200','2210','2230','5580','5800','5641']
  loop
    select coalesce(sum(jl.debit - jl.credit), 0) into v_gl
      from journal_lines jl
      join journal_entries je on je.id = jl.journal_entry_id
      join accounts a on a.id = jl.account_id
     where je.company_id = v_period.company_id
       and je.entry_date >= v_period.period_start
       and je.entry_date < v_period.period_end
       and is_ledger_truth_status(je.status)
       and a.account_number = v_acc;
    v_row := v_row || jsonb_build_array(jsonb_build_object('account_number', v_acc, 'gl_movement', v_gl));
  end loop;

  v_var := v_period.net_vat
    - (
      -- output credit-positive on 2200+2210 minus input debit-positive 1400+1410+1415
      coalesce((
        select sum(case when a.account_number in ('2200','2210') then jl.credit - jl.debit else 0 end)
             - sum(case when a.account_number in ('1400','1410','1415') then jl.debit - jl.credit else 0 end)
          from journal_lines jl
          join journal_entries je on je.id = jl.journal_entry_id
          join accounts a on a.id = jl.account_id
         where je.company_id = v_period.company_id
           and je.entry_date >= v_period.period_start
           and je.entry_date < v_period.period_end
           and is_ledger_truth_status(je.status)
           and a.account_number in ('1400','1410','1415','2200','2210')
      ), 0)
    );
  -- Groups already equal header net_vat; unexplained is header vs GL output-input.
  v_unexplained := round(v_var, 2);

  return jsonb_build_object(
    'period_id', v_period.id,
    'net_vat', v_period.net_vat,
    'unexplained_variance', v_unexplained,
    'accounts', v_row
  );
end;
$$;
revoke all on function reconcile_vat_return(uuid) from public;
revoke all on function reconcile_vat_return(uuid) from authenticated;
revoke all on function reconcile_vat_return(uuid) from anon;
grant execute on function reconcile_vat_return(uuid) to service_role;

create or replace function settle_vat_return(p_period_id uuid, p_actor_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period vat_return_periods%rowtype;
  v_o numeric(18,2);
  v_i numeric(18,2);
  v_rcm_o numeric(18,2);
  v_rcm_i numeric(18,2);
  v_relief numeric(18,2);
  v_t numeric(18,2);
  v_lines jsonb := '[]'::jsonb;
  v_je uuid;
begin
  -- [feature-spec-1_1_F.md F-31 / F-44]
  select * into v_period from vat_return_periods where id = p_period_id;
  select coalesce(sum(case when a.account_number in ('2200','2210') then jl.credit - jl.debit else 0 end), 0),
         coalesce(sum(case when a.account_number in ('1400','1410','1415') then jl.debit - jl.credit else 0 end), 0),
         coalesce(sum(case when a.account_number = '2210' then jl.credit - jl.debit else 0 end), 0),
         coalesce(sum(case when a.account_number = '1410' then jl.debit - jl.credit else 0 end), 0),
         coalesce(sum(case when a.account_number = '1415' then jl.debit - jl.credit else 0 end), 0)
    into v_o, v_i, v_rcm_o, v_rcm_i, v_relief
    from journal_lines jl
    join journal_entries je on je.id = jl.journal_entry_id
    join accounts a on a.id = jl.account_id
   where je.company_id = v_period.company_id
     and je.entry_date >= v_period.period_start
     and je.entry_date < v_period.period_end
     and is_ledger_truth_status(je.status);

  -- Pairwise washes stay balanced. [feature-spec-1_1_F.md F-31 / F-44]
  v_t := least(greatest(v_o - v_rcm_o, 0), greatest(v_i - v_rcm_i - v_relief, 0));
  if v_t > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_number','2200','debit', v_t, 'credit', 0, 'description', 'VAT return settlement'),
      jsonb_build_object('account_number','1400','debit', 0, 'credit', v_t, 'description', 'VAT return settlement')
    );
  end if;
  if least(v_rcm_o, v_rcm_i) > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_number','2210','debit', least(v_rcm_o, v_rcm_i), 'credit', 0, 'description', 'RCM wash'),
      jsonb_build_object('account_number','1410','debit', 0, 'credit', least(v_rcm_o, v_rcm_i), 'description', 'RCM wash')
    );
  end if;
  if v_relief > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_number','2200','debit', v_relief, 'credit', 0, 'description', 'Bad debt relief wash'),
      jsonb_build_object('account_number','1415','debit', 0, 'credit', v_relief, 'description', 'Bad debt relief wash')
    );
  end if;

  if jsonb_array_length(v_lines) = 0 then
    return null;
  end if;

  v_je := post_vat_journal_entry(
    v_period.company_id,
    v_period.period_end - 1,
    'vat_return_settlement',
    'VAT return settlement',
    p_actor_id,
    v_lines,
    v_period.id::text
  );
  return v_je;
end;
$$;
revoke all on function settle_vat_return(uuid, uuid) from public;
revoke all on function settle_vat_return(uuid, uuid) from authenticated;
revoke all on function settle_vat_return(uuid, uuid) from anon;
grant execute on function settle_vat_return(uuid, uuid) to service_role;

create or replace function approve_vat_return(p_period_id uuid, p_actor_id uuid)
returns vat_return_periods
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period vat_return_periods%rowtype;
  v_recon jsonb;
  v_je uuid;
begin
  -- [feature-spec-1_1_F.md F-8 / F-31]
  perform pg_advisory_xact_lock(hashtext('vat:' || (
    select company_id::text from vat_return_periods where id = p_period_id
  )));
  select * into v_period from vat_return_periods where id = p_period_id for update;
  if not found then
    raise exception 'VAT_RETURN_NOT_FOUND';
  end if;
  if v_period.status <> 'under_review' then
    raise exception 'VAT_RETURN_NOT_UNDER_REVIEW';
  end if;
  v_recon := reconcile_vat_return(p_period_id);
  if coalesce((v_recon->>'unexplained_variance')::numeric, 0) <> 0 then
    raise exception 'VAT_RETURN_UNRECONCILED';
  end if;
  v_je := settle_vat_return(p_period_id, p_actor_id);
  update vat_return_periods
     set status = 'approved',
         approved_by = p_actor_id,
         approved_at = now(),
         settlement_journal_entry_id = v_je,
         updated_at = now()
   where id = p_period_id
  returning * into v_period;
  return v_period;
end;
$$;
revoke all on function approve_vat_return(uuid, uuid) from public;
revoke all on function approve_vat_return(uuid, uuid) from authenticated;
revoke all on function approve_vat_return(uuid, uuid) from anon;
grant execute on function approve_vat_return(uuid, uuid) to service_role;

create or replace function file_vat_return(p_period_id uuid, p_actor_id uuid)
returns vat_return_periods
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period vat_return_periods%rowtype;
  v_missing int;
begin
  -- [feature-spec-1_1_F.md F-9 / F-10]
  perform pg_advisory_xact_lock(hashtext('vat:' || (
    select company_id::text from vat_return_periods where id = p_period_id
  )));
  select * into v_period from vat_return_periods where id = p_period_id for update;
  if not found then
    raise exception 'VAT_RETURN_NOT_FOUND';
  end if;
  if v_period.status <> 'approved' then
    raise exception 'VAT_RETURN_NOT_APPROVED';
  end if;
  select count(*) into v_missing
    from vat_return_line_items li
   where li.period_id = p_period_id
     and li.amount <> 0
     and li.fta_box_code is null;
  if v_missing > 0 then
    raise exception 'VAT_BOX_MAP_INCOMPLETE';
  end if;
  insert into fta_filing_log (vat_return_period_id, adapter_status, adapter_response, attempted_by)
  values (p_period_id, 'not_available', jsonb_build_object('reason', 'FTA adapter stub'), p_actor_id);
  update vat_return_periods
     set status = 'filed', filed_at = now(), filed_by = p_actor_id, updated_at = now()
   where id = p_period_id
  returning * into v_period;
  return v_period;
end;
$$;
revoke all on function file_vat_return(uuid, uuid) from public;
revoke all on function file_vat_return(uuid, uuid) from authenticated;
revoke all on function file_vat_return(uuid, uuid) from anon;
grant execute on function file_vat_return(uuid, uuid) to service_role;

create or replace function export_vat_return(p_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_missing int;
  v_csv text;
begin
  -- [feature-spec-1_1_F.md F-9] CSV of groups in box-map order; no generic exporter.
  select count(*) into v_missing
    from vat_return_line_items li
   where li.period_id = p_period_id
     and li.amount <> 0
     and li.fta_box_code is null;
  if v_missing > 0 then
    raise exception 'VAT_BOX_MAP_INCOMPLETE';
  end if;
  select string_agg(
           concat_ws(',', coalesce(li.fta_box_code, ''), li.group_key, coalesce(li.emirate::text, ''), li.amount::text),
           E'\n'
           order by coalesce(li.fta_box_code, '99'), li.group_key, li.emirate::text
         )
    into v_csv
    from vat_return_line_items li
   where li.period_id = p_period_id;
  return jsonb_build_object('csv', 'box,group_key,emirate,amount' || E'\n' || coalesce(v_csv, ''));
end;
$$;
revoke all on function export_vat_return(uuid) from public;
revoke all on function export_vat_return(uuid) from authenticated;
revoke all on function export_vat_return(uuid) from anon;
grant execute on function export_vat_return(uuid) to service_role;

create or replace function claim_vat_refund(p_period_id uuid, p_actor_id uuid)
returns vat_return_periods
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period vat_return_periods%rowtype;
  v_je uuid;
begin
  -- [feature-spec-1_1_F.md F-22]
  select * into v_period from vat_return_periods where id = p_period_id for update;
  if not found then
    raise exception 'VAT_RETURN_NOT_FOUND';
  end if;
  if v_period.refund_claim_status <> 'eligible' then
    raise exception 'VAT_REFUND_NOT_ELIGIBLE';
  end if;
  if current_date > (v_period.period_end + interval '5 years')::date then
    raise exception 'VAT_REFUND_WINDOW_EXPIRED';
  end if;
  v_je := post_vat_journal_entry(
    v_period.company_id,
    current_date,
    'vat_refund_claim',
    'VAT refund claim',
    p_actor_id,
    jsonb_build_array(
      jsonb_build_object('account_number','1420','debit', abs(v_period.net_vat), 'credit', 0, 'description', 'VAT Refund Receivable from FTA'),
      jsonb_build_object('account_number','1400','debit', 0, 'credit', abs(v_period.net_vat), 'description', 'VAT Receivable (Input VAT)')
    ),
    v_period.id::text
  );
  update vat_return_periods
     set refund_claim_status = 'claimed', updated_at = now()
   where id = p_period_id
  returning * into v_period;
  return v_period;
end;
$$;
revoke all on function claim_vat_refund(uuid, uuid) from public;
revoke all on function claim_vat_refund(uuid, uuid) from authenticated;
revoke all on function claim_vat_refund(uuid, uuid) from anon;
grant execute on function claim_vat_refund(uuid, uuid) to service_role;

create or replace function record_vat_payment(
  p_period_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_method payment_method_type,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period vat_return_periods%rowtype;
  v_cash uuid;
  v_target char(4);
  v_cap numeric(18,2);
  v_je uuid;
begin
  -- [feature-spec-1_1_F.md F-30]
  perform pg_advisory_xact_lock(hashtext('vpy:' || p_period_id::text));
  select * into v_period from vat_return_periods where id = p_period_id for update;
  if not found then
    raise exception 'VAT_RETURN_NOT_FOUND';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'VAT_PAYMENT_AMOUNT_INVALID';
  end if;
  if v_period.refund_claim_status = 'claimed' then
    v_target := '1420';
    v_cap := abs(v_period.net_vat);
  else
    v_target := '2200';
    v_cap := greatest(v_period.net_vat, 0);
  end if;
  if p_amount > v_cap then
    raise exception 'VAT_PAYMENT_EXCEEDS_PAYABLE';
  end if;
  v_cash := resolve_payment_debit_account_id(v_period.company_id, null, p_method);
  v_je := post_vat_journal_entry(
    v_period.company_id,
    coalesce(p_payment_date, current_date),
    'vat_payment',
    'VAT payment to FTA',
    p_actor_id,
    jsonb_build_array(
      jsonb_build_object('account_number', v_target, 'debit', p_amount, 'credit', 0, 'description', 'VAT payment to FTA'),
      jsonb_build_object('account_number', (select account_number from accounts where id = v_cash), 'debit', 0, 'credit', p_amount, 'description', 'VAT payment to FTA')
    ),
    v_period.id::text
  );
  return v_je;
end;
$$;
revoke all on function record_vat_payment(uuid, numeric, date, payment_method_type, uuid) from public;
revoke all on function record_vat_payment(uuid, numeric, date, payment_method_type, uuid) from authenticated;
revoke all on function record_vat_payment(uuid, numeric, date, payment_method_type, uuid) from anon;
grant execute on function record_vat_payment(uuid, numeric, date, payment_method_type, uuid) to service_role;

create or replace function vat_return_penalty_warning(p_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period vat_return_periods%rowtype;
  v_late_file numeric(18,2) := 0;
  v_late_pay numeric(18,2) := 0;
  v_vd numeric(18,2) := 0;
  v_repeat int;
  v_days int;
begin
  -- [feature-spec-1_1_F.md F-28] warn only.
  select * into v_period from vat_return_periods where id = p_period_id;
  if not found then
    raise exception 'VAT_RETURN_NOT_FOUND';
  end if;
  if v_period.payment_due_date is not null
     and current_date > v_period.payment_due_date
     and v_period.status <> 'filed' then
    select count(*) into v_repeat
      from vat_return_periods p
     where p.company_id = v_period.company_id
       and p.id <> v_period.id
       and p.filed_at is not null
       and p.payment_due_date is not null
       and p.filed_at::date > p.payment_due_date
       and p.filed_at >= (now() - interval '24 months');
    v_late_file := case when v_repeat > 0 then 2000 else 1000 end;
  end if;
  if v_period.net_vat > 0
     and v_period.payment_due_date is not null
     and current_date > v_period.payment_due_date
     and not exists (
       select 1 from journal_entries je
        where je.company_id = v_period.company_id
          and je.entry_type = 'vat_payment'
          and je.reference_number = v_period.id::text
          and is_ledger_truth_status(je.status)
     ) then
    v_days := current_date - v_period.payment_due_date;
    v_late_pay := round(v_period.net_vat * 0.14 * v_days / 365.0, 2);
  end if;
  select coalesce(sum(round(abs(d.delta_net_vat) * 0.01 * greatest(1,
           extract(month from age(current_date, d.discovered_at))::int), 2)), 0)
    into v_vd
    from vat_voluntary_disclosures d
   where d.original_period_id = p_period_id
     and d.status = 'draft';
  return jsonb_build_object(
    'late_filing', v_late_file,
    'late_payment', v_late_pay,
    'voluntary_disclosure', v_vd,
    'total', v_late_file + v_late_pay + v_vd
  );
end;
$$;
revoke all on function vat_return_penalty_warning(uuid) from public;
revoke all on function vat_return_penalty_warning(uuid) from authenticated;
revoke all on function vat_return_penalty_warning(uuid) from anon;
grant execute on function vat_return_penalty_warning(uuid) to service_role;

create or replace function accrue_vat_penalty(p_period_id uuid, p_amount numeric, p_actor_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period vat_return_periods%rowtype;
  v_2230 uuid;
begin
  -- [feature-spec-1_1_F.md F-28]
  select * into v_period from vat_return_periods where id = p_period_id;
  if p_amount is null or p_amount <= 0 then
    raise exception 'VAT_PENALTY_AMOUNT_INVALID';
  end if;
  v_2230 := account_id_by_number(v_period.company_id, '2230', true);
  if v_2230 is null then
    raise exception 'VAT_PENALTY_ACCOUNT_INACTIVE';
  end if;
  return post_vat_journal_entry(
    v_period.company_id,
    current_date,
    'vat_penalty',
    'VAT penalty accrual',
    p_actor_id,
    jsonb_build_array(
      jsonb_build_object('account_number','5810','debit', p_amount, 'credit', 0, 'description', 'VAT Penalties & Fines'),
      jsonb_build_object('account_number','2230','debit', 0, 'credit', p_amount, 'description', 'VAT Penalty Accrual')
    ),
    p_period_id::text
  );
end;
$$;
revoke all on function accrue_vat_penalty(uuid, numeric, uuid) from public;
revoke all on function accrue_vat_penalty(uuid, numeric, uuid) from authenticated;
revoke all on function accrue_vat_penalty(uuid, numeric, uuid) from anon;
grant execute on function accrue_vat_penalty(uuid, numeric, uuid) to service_role;


create or replace function calculate_partial_exemption(p_period_id uuid, p_actor_id uuid)
returns vat_apportionment_calculations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period vat_return_periods%rowtype;
  v_taxable numeric(18,2) := 0;
  v_exempt numeric(18,2) := 0;
  v_pct numeric(9,6);
  v_mixed numeric(18,2) := 0;
  v_irrec numeric(18,2);
  v_je uuid;
  v_row vat_apportionment_calculations%rowtype;
begin
  -- [feature-spec-1_1_F.md F-4 / F-35]
  select * into v_period from vat_return_periods where id = p_period_id for update;
  if not found then
    raise exception 'VAT_RETURN_NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(hashtext('vap:' || v_period.company_id::text));

  select coalesce((
    select sum(line_net_amount(il.quantity, il.unit_price, il.discount_percent, il.discount_amount))
      from invoice_lines il join invoices i on i.id = il.invoice_id
     where i.company_id = v_period.company_id
       and i.invoice_date >= v_period.period_start and i.invoice_date < v_period.period_end
       and i.status not in ('draft', 'void')
       and il.vat_category in ('standard_rated', 'zero_rated')
  ), 0) - coalesce((
    select sum(line_net_amount(cnl.quantity, cnl.unit_price, cnl.discount_percent, cnl.discount_amount))
      from credit_note_lines cnl join credit_notes cn on cn.id = cnl.credit_note_id
     where cn.company_id = v_period.company_id
       and cn.credit_note_date >= v_period.period_start and cn.credit_note_date < v_period.period_end
       and cn.status not in ('draft', 'void')
       and cnl.vat_category in ('standard_rated', 'zero_rated')
  ), 0)
    into v_taxable;

  select coalesce((
    select sum(line_net_amount(il.quantity, il.unit_price, il.discount_percent, il.discount_amount))
      from invoice_lines il join invoices i on i.id = il.invoice_id
     where i.company_id = v_period.company_id
       and i.invoice_date >= v_period.period_start and i.invoice_date < v_period.period_end
       and i.status not in ('draft', 'void')
       and il.vat_category = 'exempt'
  ), 0) - coalesce((
    select sum(line_net_amount(cnl.quantity, cnl.unit_price, cnl.discount_percent, cnl.discount_amount))
      from credit_note_lines cnl join credit_notes cn on cn.id = cnl.credit_note_id
     where cn.company_id = v_period.company_id
       and cn.credit_note_date >= v_period.period_start and cn.credit_note_date < v_period.period_end
       and cn.status not in ('draft', 'void')
       and cnl.vat_category = 'exempt'
  ), 0)
    into v_exempt;

  if v_taxable + v_exempt > 0 then
    v_pct := round(v_taxable / (v_taxable + v_exempt), 6);
  else
    v_pct := 0;
  end if;

  select coalesce(sum(round(
           line_net_amount(bl.quantity, bl.unit_price, bl.discount_percent, bl.discount_amount) * bl.vat_rate / 100
         , 2)), 0)
    into v_mixed
    from bill_lines bl
    join bills b on b.id = bl.bill_id
   where b.company_id = v_period.company_id
     and b.bill_date >= v_period.period_start and b.bill_date < v_period.period_end
     and b.status not in ('draft', 'matched', 'void')
     and bl.vat_input_treatment = 'mixed_use';

  v_irrec := round(v_mixed * (1 - v_pct), 2);
  v_je := null;
  if v_irrec > 0 then
    v_je := post_vat_journal_entry(
      v_period.company_id,
      v_period.period_end - 1,
      'vat_apportionment',
      'Partial exemption apportionment',
      p_actor_id,
      jsonb_build_array(
        jsonb_build_object('account_number','5800','debit', v_irrec, 'credit', 0, 'description', 'Irrecoverable mixed-use input VAT'),
        jsonb_build_object('account_number','1400','debit', 0, 'credit', v_irrec, 'description', 'Irrecoverable mixed-use input VAT')
      ),
      p_period_id::text
    );
  end if;

  insert into vat_apportionment_calculations (
    period_id, taxable_output, exempt_output, recoverable_pct, journal_entry_id, calculated_at, calculated_by
  ) values (
    p_period_id, v_taxable, v_exempt, v_pct, v_je, now(), p_actor_id
  )
  on conflict (period_id) do update
    set taxable_output = excluded.taxable_output,
        exempt_output = excluded.exempt_output,
        recoverable_pct = excluded.recoverable_pct,
        journal_entry_id = excluded.journal_entry_id,
        calculated_at = excluded.calculated_at,
        calculated_by = excluded.calculated_by
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function calculate_partial_exemption(uuid, uuid) from public;
revoke all on function calculate_partial_exemption(uuid, uuid) from authenticated;
revoke all on function calculate_partial_exemption(uuid, uuid) from anon;
grant execute on function calculate_partial_exemption(uuid, uuid) to service_role;

create or replace function capital_goods_project_spend(p_project_id uuid)
returns numeric(18,2)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  return coalesce((
    select sum(line_net_amount(bl.quantity, bl.unit_price, bl.discount_percent, bl.discount_amount))
      from bill_lines bl
      join bills b on b.id = bl.bill_id
     where bl.capital_goods_project_id = p_project_id
       and b.status not in ('draft', 'void')
  ), 0);
end;
$$;

create or replace function assert_cas_threshold(p_company_id uuid, p_project_id uuid, p_line_net numeric, p_on_date date)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rules vat_tax_rule_versions%rowtype;
  v_spend numeric(18,2);
begin
  -- [feature-spec-1_1_F.md F-40]
  v_rules := effective_vat_tax_rules(p_on_date);
  if p_project_id is not null then
    v_spend := capital_goods_project_spend(p_project_id) + coalesce(p_line_net, 0);
  else
    v_spend := coalesce(p_line_net, 0);
  end if;
  if v_spend < v_rules.cas_threshold then
    raise exception 'CAS_BELOW_THRESHOLD';
  end if;
end;
$$;
revoke all on function assert_cas_threshold(uuid, uuid, numeric, date) from public;
revoke all on function assert_cas_threshold(uuid, uuid, numeric, date) from authenticated;
revoke all on function assert_cas_threshold(uuid, uuid, numeric, date) from anon;
grant execute on function assert_cas_threshold(uuid, uuid, numeric, date) to service_role;

create or replace function run_capital_goods_adjustment(
  p_item_id uuid,
  p_fiscal_year integer,
  p_actual_use_pct numeric,
  p_actor_id uuid
)
returns capital_goods_adjustments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item capital_goods_items%rowtype;
  v_initial_recovered numeric(18,2);
  v_amt numeric(18,2);
  v_je uuid;
  v_row capital_goods_adjustments%rowtype;
  v_dr char(4);
  v_cr char(4);
begin
  -- [feature-spec-1_1_F.md F-5 / F-20]
  select * into v_item from capital_goods_items where id = p_item_id for update;
  if not found then
    raise exception 'CAPITAL_GOODS_ITEM_NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(hashtext('cgs:' || v_item.company_id::text));
  v_initial_recovered := round(v_item.initial_vat * v_item.initial_recovery_pct / 100, 2);
  v_amt := round(
    v_initial_recovered * (p_actual_use_pct - v_item.initial_recovery_pct) / v_item.adjustment_period_years
  , 2);
  if v_amt < 0 then
    v_dr := '5800'; v_cr := '1400'; v_amt := abs(v_amt);
  elsif v_amt > 0 then
    v_dr := '1400'; v_cr := '5800';
  else
    v_dr := null;
  end if;
  if v_dr is not null then
    v_je := post_vat_journal_entry(
      v_item.company_id,
      make_date(p_fiscal_year, 12, 31),
      'vat_capital_goods_adjustment',
      'Capital goods scheme adjustment',
      p_actor_id,
      jsonb_build_array(
        jsonb_build_object('account_number', v_dr, 'debit', v_amt, 'credit', 0, 'description', 'CGS adjustment'),
        jsonb_build_object('account_number', v_cr, 'debit', 0, 'credit', v_amt, 'description', 'CGS adjustment')
      ),
      p_item_id::text
    );
  end if;
  insert into capital_goods_adjustments (
    item_id, fiscal_year, actual_use_pct, adjustment_amount, journal_entry_id, created_by
  ) values (
    p_item_id, p_fiscal_year, p_actual_use_pct, coalesce(v_amt, 0) * case when v_dr = '5800' then -1 else 1 end, v_je, p_actor_id
  )
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function run_capital_goods_adjustment(uuid, integer, numeric, uuid) from public;
revoke all on function run_capital_goods_adjustment(uuid, integer, numeric, uuid) from authenticated;
revoke all on function run_capital_goods_adjustment(uuid, integer, numeric, uuid) from anon;
grant execute on function run_capital_goods_adjustment(uuid, integer, numeric, uuid) to service_role;

create or replace function insert_bad_debt_relief_claim(p_write_off_id uuid, p_actor_id uuid)
returns vat_bad_debt_relief_claims
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wo write_offs%rowtype;
  v_vat numeric(18,2);
  v_row vat_bad_debt_relief_claims%rowtype;
begin
  -- [feature-spec-1_1_F.md F-6 / F-18]
  select * into v_wo from write_offs where id = p_write_off_id;
  if not found then
    raise exception 'WRITE_OFF_NOT_FOUND';
  end if;
  if v_wo.vat_relief_eligible is not true then
    raise exception 'VAT_RELIEF_NOT_ELIGIBLE';
  end if;
  select coalesce(sum(round(
           line_net_amount(il.quantity, il.unit_price, il.discount_percent, il.discount_amount) * il.vat_rate / 100
         , 2)), 0)
    into v_vat
    from invoice_lines il
   where il.invoice_id = v_wo.invoice_id;
  if v_vat <= 0 then
    raise exception 'VAT_RELIEF_AMOUNT_INVALID';
  end if;
  insert into vat_bad_debt_relief_claims (company_id, write_off_id, vat_amount)
  values (v_wo.company_id, p_write_off_id, v_vat)
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function insert_bad_debt_relief_claim(uuid, uuid) from public;
revoke all on function insert_bad_debt_relief_claim(uuid, uuid) from authenticated;
revoke all on function insert_bad_debt_relief_claim(uuid, uuid) from anon;
grant execute on function insert_bad_debt_relief_claim(uuid, uuid) to service_role;

create or replace function claim_bad_debt_relief(p_claim_id uuid, p_actor_id uuid)
returns vat_bad_debt_relief_claims
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claim vat_bad_debt_relief_claims%rowtype;
  v_je uuid;
begin
  -- [feature-spec-1_1_F.md F-41]
  select * into v_claim from vat_bad_debt_relief_claims where id = p_claim_id for update;
  if not found then
    raise exception 'VAT_RELIEF_CLAIM_NOT_FOUND';
  end if;
  if v_claim.status <> 'pending_eligible' then
    raise exception 'VAT_RELIEF_NOT_PENDING';
  end if;
  perform pg_advisory_xact_lock(hashtext('vbd:' || v_claim.company_id::text));
  v_je := post_vat_journal_entry(
    v_claim.company_id,
    current_date,
    'vat_bad_debt_relief',
    'VAT bad debt relief',
    p_actor_id,
    jsonb_build_array(
      jsonb_build_object('account_number','1415','debit', v_claim.vat_amount, 'credit', 0, 'description', 'VAT Receivable, Bad Debt Relief'),
      jsonb_build_object('account_number','5641','debit', 0, 'credit', v_claim.vat_amount, 'description', 'Bad Debt Recovery')
    ),
    p_claim_id::text
  );
  update vat_bad_debt_relief_claims
     set status = 'claimed', journal_entry_id = v_je, claimed_at = now()
   where id = p_claim_id
  returning * into v_claim;
  return v_claim;
end;
$$;
revoke all on function claim_bad_debt_relief(uuid, uuid) from public;
revoke all on function claim_bad_debt_relief(uuid, uuid) from authenticated;
revoke all on function claim_bad_debt_relief(uuid, uuid) from anon;
grant execute on function claim_bad_debt_relief(uuid, uuid) to service_role;

create or replace function create_vat_period_correction(
  p_original_period_id uuid,
  p_delta_net_vat numeric,
  p_emirate_mismatch boolean,
  p_discovered_at date,
  p_error_description text,
  p_corrected_figures jsonb,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_orig vat_return_periods%rowtype;
  v_rules vat_tax_rule_versions%rowtype;
  v_path vat_correction_path;
  v_due date;
  v_vd vat_voluntary_disclosures%rowtype;
  v_corr vat_period_corrections%rowtype;
  v_next vat_return_periods%rowtype;
  v_je uuid;
begin
  -- [feature-spec-1_1_F.md F-39] server chooses path; client cannot bypass VD.
  select * into v_orig from vat_return_periods where id = p_original_period_id;
  if not found or v_orig.status <> 'filed' then
    raise exception 'VAT_RETURN_NOT_FILED';
  end if;
  v_rules := effective_vat_tax_rules(coalesce(p_discovered_at, current_date));
  if coalesce(p_emirate_mismatch, false) or abs(coalesce(p_delta_net_vat, 0)) > v_rules.vd_amount_threshold then
    v_path := 'voluntary_disclosure';
  else
    v_path := 'next_period';
  end if;

  if v_path = 'voluntary_disclosure' then
    v_due := add_business_days(v_orig.company_id, coalesce(p_discovered_at, current_date), 20);
    insert into vat_voluntary_disclosures (
      company_id, original_period_id, error_description, corrected_figures,
      delta_net_vat, path, emirate_mismatch, discovered_at, due_by, created_by
    ) values (
      v_orig.company_id, p_original_period_id, coalesce(p_error_description, 'VAT correction'),
      coalesce(p_corrected_figures, '{}'::jsonb), coalesce(p_delta_net_vat, 0),
      v_path, coalesce(p_emirate_mismatch, false), coalesce(p_discovered_at, current_date),
      v_due, p_actor_id
    ) returning * into v_vd;
    return jsonb_build_object('path', v_path, 'voluntary_disclosure', to_jsonb(v_vd));
  end if;

  perform pg_advisory_xact_lock(hashtext('vpc:' || v_orig.company_id::text));
  select * into v_next
    from vat_return_periods
   where company_id = v_orig.company_id
     and status not in ('filed', 'superseded', 'approved')
     and period_start >= v_orig.period_end
   order by period_start
   limit 1;
  if not found then
    insert into vat_return_periods (company_id, period_start, period_end)
    select v_orig.company_id, b.o_start, b.o_end
      from vat_period_bounds(v_orig.company_id, v_orig.period_end) as b(o_start, o_end)
    returning * into v_next;
  end if;

  if coalesce(p_delta_net_vat, 0) <> 0 then
    v_je := post_vat_journal_entry(
      v_orig.company_id,
      v_next.period_start,
      'vat_period_correction',
      'Next-period VAT correction',
      p_actor_id,
      case when p_delta_net_vat > 0 then
        jsonb_build_array(
          jsonb_build_object('account_number','5800','debit', p_delta_net_vat, 'credit', 0, 'description', 'VAT period correction'),
          jsonb_build_object('account_number','2200','debit', 0, 'credit', p_delta_net_vat, 'description', 'VAT period correction')
        )
      else
        jsonb_build_array(
          jsonb_build_object('account_number','2200','debit', abs(p_delta_net_vat), 'credit', 0, 'description', 'VAT period correction'),
          jsonb_build_object('account_number','1400','debit', 0, 'credit', abs(p_delta_net_vat), 'description', 'VAT period correction')
        )
      end,
      p_original_period_id::text
    );
  end if;

  insert into vat_period_corrections (
    company_id, original_period_id, correction_period_id, delta_net_vat, journal_entry_id, created_by
  ) values (
    v_orig.company_id, p_original_period_id, v_next.id, coalesce(p_delta_net_vat, 0), v_je, p_actor_id
  ) returning * into v_corr;
  return jsonb_build_object('path', v_path, 'correction', to_jsonb(v_corr));
end;
$$;
revoke all on function create_vat_period_correction(uuid, numeric, boolean, date, text, jsonb, uuid) from public;
revoke all on function create_vat_period_correction(uuid, numeric, boolean, date, text, jsonb, uuid) from authenticated;
revoke all on function create_vat_period_correction(uuid, numeric, boolean, date, text, jsonb, uuid) from anon;
grant execute on function create_vat_period_correction(uuid, numeric, boolean, date, text, jsonb, uuid) to service_role;

create or replace function approve_vat_voluntary_disclosure(p_disclosure_id uuid, p_actor_id uuid)
returns vat_voluntary_disclosures
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_d vat_voluntary_disclosures%rowtype;
  v_orig vat_return_periods%rowtype;
begin
  -- [feature-spec-1_1_F.md F-12] Owner approval; does not call FTA.
  select * into v_d from vat_voluntary_disclosures where id = p_disclosure_id for update;
  if not found then
    raise exception 'VAT_VOLUNTARY_DISCLOSURE_NOT_FOUND';
  end if;
  if v_d.status <> 'draft' then
    raise exception 'VAT_VOLUNTARY_DISCLOSURE_NOT_DRAFT';
  end if;
  select * into v_orig from vat_return_periods where id = v_d.original_period_id for update;
  insert into vat_return_periods (
    company_id, period_start, period_end, status, supersedes_period_id
  ) values (
    v_orig.company_id, v_orig.period_start, v_orig.period_end, 'draft', v_orig.id
  );
  update vat_return_periods set status = 'superseded', updated_at = now() where id = v_orig.id;
  update vat_voluntary_disclosures
     set status = 'approved', approved_by = p_actor_id, approved_at = now()
   where id = p_disclosure_id
  returning * into v_d;
  return v_d;
end;
$$;
revoke all on function approve_vat_voluntary_disclosure(uuid, uuid) from public;
revoke all on function approve_vat_voluntary_disclosure(uuid, uuid) from authenticated;
revoke all on function approve_vat_voluntary_disclosure(uuid, uuid) from anon;
grant execute on function approve_vat_voluntary_disclosure(uuid, uuid) to service_role;

create or replace function get_invoice_register(p_company_id uuid, p_year integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- [feature-spec-1_1_F.md F-16]
  return coalesce((
    select jsonb_agg(to_jsonb(r) order by r.invoice_number)
      from vat_invoice_register r
     where r.company_id = p_company_id
       and r.register_year = p_year
  ), '[]'::jsonb);
end;
$$;
revoke all on function get_invoice_register(uuid, integer) from public;
revoke all on function get_invoice_register(uuid, integer) from authenticated;
revoke all on function get_invoice_register(uuid, integer) from anon;
grant execute on function get_invoice_register(uuid, integer) to service_role;

create or replace function assemble_vat_audit_pack(p_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period vat_return_periods%rowtype;
begin
  -- [feature-spec-1_1_F.md F-15] JSON aggregation; no PDF.
  select * into v_period from vat_return_periods where id = p_period_id;
  if not found then
    raise exception 'VAT_RETURN_NOT_FOUND';
  end if;
  return jsonb_build_object(
    'return', to_jsonb(v_period),
    'groups', coalesce((select jsonb_agg(to_jsonb(li)) from vat_return_line_items li where li.period_id = p_period_id), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(to_jsonb(s))
        from vat_return_line_item_sources s
        join vat_return_line_items li on li.id = s.line_item_id
       where li.period_id = p_period_id
    ), '[]'::jsonb),
    'invoice_register', get_invoice_register(
      v_period.company_id, extract(year from v_period.period_start)::int
    ),
    'write_off_flags', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'invoice_id', w.invoice_id, 'vat_relief_eligible', w.vat_relief_eligible
      ))
        from write_offs w
       where w.company_id = v_period.company_id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function assemble_vat_audit_pack(uuid) from public;
revoke all on function assemble_vat_audit_pack(uuid) from authenticated;
revoke all on function assemble_vat_audit_pack(uuid) from anon;
grant execute on function assemble_vat_audit_pack(uuid) to service_role;

create or replace function get_vat_registration_threshold(p_company_id uuid, p_as_of date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from date;
  v_supplies numeric(18,2);
  v_trn text;
begin
  -- [feature-spec-1_1_F.md F-32] AED 375,000 mandatory / 187,500 voluntary.
  v_from := (coalesce(p_as_of, current_date) - interval '12 months')::date;

  select coalesce((
    select sum(line_net_amount(il.quantity, il.unit_price, il.discount_percent, il.discount_amount))
      from invoice_lines il join invoices i on i.id = il.invoice_id
     where i.company_id = p_company_id
       and i.invoice_date >= v_from and i.invoice_date <= coalesce(p_as_of, current_date)
       and i.status not in ('draft', 'void')
       and il.vat_category in ('standard_rated', 'zero_rated')
  ), 0) + coalesce((
    select sum(line_net_amount(bl.quantity, bl.unit_price, bl.discount_percent, bl.discount_amount))
      from bill_lines bl join bills b on b.id = bl.bill_id
     where b.company_id = p_company_id
       and b.bill_date >= v_from and b.bill_date <= coalesce(p_as_of, current_date)
       and b.status not in ('draft', 'matched', 'void')
       and bl.vat_input_treatment = 'reverse_charge'
  ), 0)
    into v_supplies;

  select trn into v_trn from companies where id = p_company_id;
  return jsonb_build_object(
    'taxable_supplies_12m', v_supplies,
    'mandatory_threshold', 375000,
    'voluntary_threshold', 187500,
    'mandatory_breached', v_supplies >= 375000,
    'voluntary_breached', v_supplies >= 187500,
    'already_registered', v_trn is not null and btrim(v_trn) <> ''
  );
end;
$$;
revoke all on function get_vat_registration_threshold(uuid, date) from public;
revoke all on function get_vat_registration_threshold(uuid, date) from authenticated;
revoke all on function get_vat_registration_threshold(uuid, date) from anon;
grant execute on function get_vat_registration_threshold(uuid, date) to service_role;

-- ============================================================================
-- 8. ROW-LEVEL SECURITY (multi-tenant isolation)
-- ============================================================================
-- Assumes the app sets `request.jwt.claims.company_id` (Supabase convention)
-- or an equivalent session variable per authenticated request.
-- [feature-spec.md decision #29] `companies` RLS is membership-based (not
-- `app.current_company_id`) and lives in §11 after `company_members` exists —
-- a company-scoped session variable cannot isolate the table that establishes
-- company scope in the first place.

alter table accounts enable row level security;
alter table journal_entries enable row level security;
alter table journal_lines enable row level security;
alter table accounting_periods enable row level security;
alter table journal_attachments enable row level security;
alter table recurring_journal_templates enable row level security;
alter table recurring_journal_template_lines enable row level security;
alter table audit_log enable row level security;
alter table company_settings enable row level security;
alter table customers enable row level security;
alter table quotations enable row level security;
alter table quotation_lines enable row level security;
alter table invoices enable row level security;
alter table invoice_lines enable row level security;
alter table credit_notes enable row level security;
alter table credit_note_lines enable row level security;
alter table public_holidays enable row level security;
alter table payments enable row level security;
alter table payment_applications enable row level security;
alter table write_offs enable row level security;
alter table ecl_loss_rate_policies enable row level security;
alter table ecl_provision_runs enable row level security;

alter table suppliers enable row level security;
alter table purchase_orders enable row level security;
alter table purchase_order_lines enable row level security;
alter table goods_receipts enable row level security;
alter table goods_receipt_lines enable row level security;
alter table bills enable row level security;
alter table bill_lines enable row level security;
alter table three_way_match_results enable row level security;
alter table supplier_payments enable row level security;
alter table supplier_payment_applications enable row level security;
alter table supplier_payment_runs enable row level security;
alter table supplier_payment_run_items enable row level security;
alter table supplier_statement_lines enable row level security;
alter table grni_accrual_runs enable row level security;

alter table vat_return_periods enable row level security;
alter table vat_return_line_items enable row level security;
alter table vat_return_line_item_sources enable row level security;
alter table vat_apportionment_calculations enable row level security;
alter table capital_goods_projects enable row level security;
alter table capital_goods_items enable row level security;
alter table capital_goods_adjustments enable row level security;
alter table vat_bad_debt_relief_claims enable row level security;
alter table vat_voluntary_disclosures enable row level security;
alter table vat_period_corrections enable row level security;
alter table fta_filing_log enable row level security;

alter table ct_income_adjustments enable row level security;
alter table ct_provision_entries enable row level security;
alter table related_party_transactions enable row level security;


create policy company_isolation_accounts on accounts
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);

create policy company_isolation_journal_entries on journal_entries
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);

create policy company_isolation_periods on accounting_periods
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);

create policy company_isolation_recurring_templates on recurring_journal_templates
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);

create policy company_isolation_audit_log on audit_log
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);

create policy company_isolation_settings on company_settings
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);

create policy company_isolation_customers on customers
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);

create policy company_isolation_quotations on quotations
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);

create policy company_isolation_quotation_lines on quotation_lines
  using (
    quotation_id in (
      select id from quotations
      where company_id = (select current_setting('app.current_company_id', true))::uuid
    )
  );

create policy company_isolation_invoices on invoices
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);

create policy company_isolation_invoice_lines on invoice_lines
  using (
    invoice_id in (
      select id from invoices
      where company_id = (select current_setting('app.current_company_id', true))::uuid
    )
  );

create policy company_isolation_credit_notes on credit_notes
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);

create policy company_isolation_credit_note_lines on credit_note_lines
  using (
    credit_note_id in (
      select id from credit_notes
      where company_id = (select current_setting('app.current_company_id', true))::uuid
    )
  );

-- [feature-spec-1_1_D.md §3.1b] UAE-wide (company_id null) readable by every
-- company; company-scoped rows isolated as usual. Writes must be company-scoped
-- (UAE-wide rows are seed-only — D-14).
create policy company_isolation_public_holidays on public_holidays
  using (
    company_id is null
    or company_id = (select current_setting('app.current_company_id', true))::uuid
  )
  with check (
    company_id = (select current_setting('app.current_company_id', true))::uuid
  );

create policy company_isolation_payments on payments
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);

create policy company_isolation_payment_applications on payment_applications
  using (
    payment_id in (
      select id from payments
      where company_id = (select current_setting('app.current_company_id', true))::uuid
    )
  );

create policy company_isolation_write_offs on write_offs
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);

create policy company_isolation_ecl_loss_rate_policies on ecl_loss_rate_policies
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);

create policy company_isolation_ecl_provision_runs on ecl_provision_runs
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);

create policy company_isolation_suppliers on suppliers
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);
create policy company_isolation_purchase_orders on purchase_orders
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);
create policy company_isolation_purchase_order_lines on purchase_order_lines
  using (po_id in (select id from purchase_orders where company_id = (select current_setting('app.current_company_id', true))::uuid));
create policy company_isolation_goods_receipts on goods_receipts
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);
create policy company_isolation_goods_receipt_lines on goods_receipt_lines
  using (goods_receipt_id in (select id from goods_receipts where company_id = (select current_setting('app.current_company_id', true))::uuid));
create policy company_isolation_bills on bills
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);
create policy company_isolation_bill_lines on bill_lines
  using (bill_id in (select id from bills where company_id = (select current_setting('app.current_company_id', true))::uuid));
create policy company_isolation_three_way_match_results on three_way_match_results
  using (bill_id in (select id from bills where company_id = (select current_setting('app.current_company_id', true))::uuid));
create policy company_isolation_supplier_payments on supplier_payments
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);
create policy company_isolation_supplier_payment_applications on supplier_payment_applications
  using (supplier_payment_id in (select id from supplier_payments where company_id = (select current_setting('app.current_company_id', true))::uuid));
create policy company_isolation_supplier_payment_runs on supplier_payment_runs
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);
create policy company_isolation_supplier_payment_run_items on supplier_payment_run_items
  using (run_id in (select id from supplier_payment_runs where company_id = (select current_setting('app.current_company_id', true))::uuid));
create policy company_isolation_supplier_statement_lines on supplier_statement_lines
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);
create policy company_isolation_grni_accrual_runs on grni_accrual_runs
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);

create policy company_isolation_vat_return_periods on vat_return_periods
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);
create policy company_isolation_vat_return_line_items on vat_return_line_items
  using (period_id in (
    select id from vat_return_periods
     where company_id = (select current_setting('app.current_company_id', true))::uuid
  ));
create policy company_isolation_vat_return_line_item_sources on vat_return_line_item_sources
  using (line_item_id in (
    select li.id from vat_return_line_items li
    join vat_return_periods p on p.id = li.period_id
     where p.company_id = (select current_setting('app.current_company_id', true))::uuid
  ));
create policy company_isolation_vat_apportionment_calculations on vat_apportionment_calculations
  using (period_id in (
    select id from vat_return_periods
     where company_id = (select current_setting('app.current_company_id', true))::uuid
  ));
create policy company_isolation_capital_goods_projects on capital_goods_projects
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);
create policy company_isolation_capital_goods_items on capital_goods_items
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);
create policy company_isolation_capital_goods_adjustments on capital_goods_adjustments
  using (item_id in (
    select id from capital_goods_items
     where company_id = (select current_setting('app.current_company_id', true))::uuid
  ));
create policy company_isolation_vat_bad_debt_relief_claims on vat_bad_debt_relief_claims
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);
create policy company_isolation_vat_voluntary_disclosures on vat_voluntary_disclosures
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);
create policy company_isolation_vat_period_corrections on vat_period_corrections
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);
create policy company_isolation_fta_filing_log on fta_filing_log
  using (vat_return_period_id in (
    select id from vat_return_periods
     where company_id = (select current_setting('app.current_company_id', true))::uuid
  ));

-- [feature-spec-1_1_G.md G-36] tenant tables only — ct_tax_rule_versions is global
-- like vat_tax_rule_versions (F-23 analogue: no company_id, no company_isolation_*).
create policy company_isolation_ct_income_adjustments on ct_income_adjustments
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);
create policy company_isolation_ct_provision_entries on ct_provision_entries
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);
create policy company_isolation_related_party_transactions on related_party_transactions
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);

-- journal_lines and template_lines inherit isolation via their parent entry/template
create policy company_isolation_journal_lines on journal_lines
  using (
    journal_entry_id in (
      select id from journal_entries
      where company_id = (select current_setting('app.current_company_id', true))::uuid
    )
  );

create policy company_isolation_template_lines on recurring_journal_template_lines
  using (
    template_id in (
      select id from recurring_journal_templates
      where company_id = (select current_setting('app.current_company_id', true))::uuid
    )
  );

create policy company_isolation_attachments on journal_attachments
  using (
    journal_entry_id in (
      select id from journal_entries
      where company_id = (select current_setting('app.current_company_id', true))::uuid
    )
  );

-- ============================================================================
-- 9. HELPER VIEW — trial balance (sanity-check view, expand into full reports later)
-- ============================================================================

-- [feature-spec-1.1.H1.md decision #4 / feature-spec.md decision #60]
-- Ledger-truth status for reporting reads AND v_trial_balance.
-- posted + reversed are ground truth; draft / pending_approval / rejected
-- (and approved) never contribute.
create or replace function is_ledger_truth_status(p_status journal_entry_status)
returns boolean
language sql
immutable
security invoker
parallel safe
set search_path = public, pg_temp
as $$
  select p_status in (
    'posted'::journal_entry_status,
    'reversed'::journal_entry_status
  );
$$;

revoke all on function is_ledger_truth_status(journal_entry_status) from public;
revoke all on function is_ledger_truth_status(journal_entry_status) from authenticated;
revoke all on function is_ledger_truth_status(journal_entry_status) from anon;
grant execute on function is_ledger_truth_status(journal_entry_status) to service_role;

-- [feature-spec.md decision #22] security_invoker = true is REQUIRED here.
-- Without it, Postgres runs this view's row-level security checks as the
-- VIEW OWNER, not the querying role — silently bypassing the
-- company_isolation_* RLS policies above for anyone permitted to query the
-- view. This was previously reported fixed, then found live as
-- SECURITY DEFINER again by Supabase's linter — treat this clause as
-- non-negotiable on any future CREATE OR REPLACE of this view.
--
-- [feature-spec.md decision #60] Status filter must NOT sit only in a
-- LEFT JOIN's ON clause (that left jl debit/credit in the sum when je
-- failed to match — drafts and reversed originals leaked). Qualify lines
-- via an inner subquery filtered by is_ledger_truth_status, then LEFT
-- JOIN that to accounts so empty / draft-only accounts still appear as 0.

create or replace view v_trial_balance
with (security_invoker = true)
as
select
  a.company_id,
  a.id as account_id,
  a.account_number,
  a.account_name,
  a.category,
  a.normal_balance,
  coalesce(sum(ql.debit), 0)  as total_debit,
  coalesce(sum(ql.credit), 0) as total_credit,
  case a.normal_balance
    when 'debit'  then coalesce(sum(ql.debit), 0) - coalesce(sum(ql.credit), 0)
    when 'credit' then coalesce(sum(ql.credit), 0) - coalesce(sum(ql.debit), 0)
  end as balance
from accounts a
left join (
  select
    jl.account_id,
    jl.debit,
    jl.credit
  from journal_lines jl
  join journal_entries je on je.id = jl.journal_entry_id
  where is_ledger_truth_status(je.status)
) ql on ql.account_id = a.id
group by a.company_id, a.id, a.account_number, a.account_name, a.category, a.normal_balance;

-- [feature-spec-1.1.H1.md decision #1 / #4] Period-scoped Trial Balance.
-- Opening = ledger-truth lines with entry_date < period_start.
-- Period activity = ledger-truth lines with entry_date in [period_start, period_end].
-- Closing = opening + period activity. Signed balances use the same
-- normal_balance convention as v_trial_balance. SECURITY INVOKER so RLS
-- applies like the view (#22 class — never DEFINER for reporting reads).
create or replace function get_trial_balance_for_period(
  p_company_id uuid,
  p_period_id uuid,
  p_include_zero_balance boolean default false
)
returns table (
  account_id uuid,
  account_number char(4),
  account_name text,
  category account_category,
  normal_balance normal_balance_type,
  opening_debit numeric(18,2),
  opening_credit numeric(18,2),
  opening_balance numeric(18,2),
  period_debit numeric(18,2),
  period_credit numeric(18,2),
  closing_debit numeric(18,2),
  closing_credit numeric(18,2),
  closing_balance numeric(18,2)
)
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
declare
  v_period accounting_periods%rowtype;
begin
  select * into v_period
    from accounting_periods
   where id = p_period_id;

  if not found then
    raise exception 'PERIOD_NOT_FOUND';
  end if;

  if v_period.company_id is distinct from p_company_id then
    raise exception 'PERIOD_COMPANY_MISMATCH';
  end if;

  return query
  with opening as (
    select
      jl.account_id,
      coalesce(sum(jl.debit), 0)::numeric(18,2) as debit,
      coalesce(sum(jl.credit), 0)::numeric(18,2) as credit
    from journal_lines jl
    join journal_entries je on je.id = jl.journal_entry_id
    where je.company_id = p_company_id
      and is_ledger_truth_status(je.status)
      and je.entry_date < v_period.period_start
    group by jl.account_id
  ),
  period_act as (
    select
      jl.account_id,
      coalesce(sum(jl.debit), 0)::numeric(18,2) as debit,
      coalesce(sum(jl.credit), 0)::numeric(18,2) as credit
    from journal_lines jl
    join journal_entries je on je.id = jl.journal_entry_id
    where je.company_id = p_company_id
      and is_ledger_truth_status(je.status)
      and je.entry_date >= v_period.period_start
      and je.entry_date <= v_period.period_end
    group by jl.account_id
  )
  select
    a.id,
    a.account_number,
    a.account_name,
    a.category,
    a.normal_balance,
    coalesce(o.debit, 0)::numeric(18,2),
    coalesce(o.credit, 0)::numeric(18,2),
    (case a.normal_balance
      when 'debit'  then coalesce(o.debit, 0) - coalesce(o.credit, 0)
      when 'credit' then coalesce(o.credit, 0) - coalesce(o.debit, 0)
    end)::numeric(18,2),
    coalesce(p.debit, 0)::numeric(18,2),
    coalesce(p.credit, 0)::numeric(18,2),
    (coalesce(o.debit, 0) + coalesce(p.debit, 0))::numeric(18,2),
    (coalesce(o.credit, 0) + coalesce(p.credit, 0))::numeric(18,2),
    (case a.normal_balance
      when 'debit' then
        (coalesce(o.debit, 0) + coalesce(p.debit, 0))
        - (coalesce(o.credit, 0) + coalesce(p.credit, 0))
      when 'credit' then
        (coalesce(o.credit, 0) + coalesce(p.credit, 0))
        - (coalesce(o.debit, 0) + coalesce(p.debit, 0))
    end)::numeric(18,2)
  from accounts a
  left join opening o on o.account_id = a.id
  left join period_act p on p.account_id = a.id
  where a.company_id = p_company_id
    and (
      p_include_zero_balance
      or coalesce(o.debit, 0) <> 0
      or coalesce(o.credit, 0) <> 0
      or coalesce(p.debit, 0) <> 0
      or coalesce(p.credit, 0) <> 0
    )
  order by a.account_number;
end;
$$;

revoke all on function get_trial_balance_for_period(uuid, uuid, boolean) from public;
revoke all on function get_trial_balance_for_period(uuid, uuid, boolean) from authenticated;
revoke all on function get_trial_balance_for_period(uuid, uuid, boolean) from anon;
grant execute on function get_trial_balance_for_period(uuid, uuid, boolean) to service_role;

-- [feature-spec-1.1.H1.md decision #2 / #4] Balance Sheet as of a date.
-- Cumulative A/L/E balances from journal_lines whose parent has
-- entry_date <= p_as_of_date and is_ledger_truth_status(status).
-- Including 'reversed' is required so an as-of date before the reversing
-- entry still reconstructs the original effect (original flips to
-- 'reversed' at reversal time; the reversing entry posts later).
-- Income/expense excluded — year-end close folds P&L into Retained Earnings
-- (feature-spec.md §4.4/§6). SECURITY INVOKER + §5.1 grants.
create or replace function get_balance_sheet(
  p_company_id uuid,
  p_as_of_date date
)
returns table (
  account_id uuid,
  account_number char(4),
  account_name text,
  category account_category,
  normal_balance normal_balance_type,
  total_debit numeric(18,2),
  total_credit numeric(18,2),
  balance numeric(18,2)
)
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
begin
  if p_as_of_date is null then
    raise exception 'AS_OF_DATE_REQUIRED';
  end if;

  -- Only lines whose parent entry matches status+as-of filters.
  -- Do not left-join bare journal_lines then filter je in ON — unmatched
  -- lines would still enter sum(jl.*) and break as-of / reversal tests.
  return query
  with matched_lines as (
    select
      jl.account_id,
      jl.debit,
      jl.credit
    from journal_lines jl
    join journal_entries je on je.id = jl.journal_entry_id
    where je.company_id = p_company_id
      and is_ledger_truth_status(je.status)
      and je.entry_date <= p_as_of_date
  )
  select
    a.id,
    a.account_number,
    a.account_name,
    a.category,
    a.normal_balance,
    coalesce(sum(ml.debit), 0)::numeric(18,2),
    coalesce(sum(ml.credit), 0)::numeric(18,2),
    (case a.normal_balance
      when 'debit'  then coalesce(sum(ml.debit), 0) - coalesce(sum(ml.credit), 0)
      when 'credit' then coalesce(sum(ml.credit), 0) - coalesce(sum(ml.debit), 0)
    end)::numeric(18,2)
  from accounts a
  left join matched_lines ml on ml.account_id = a.id
  where a.company_id = p_company_id
    and a.category in ('asset', 'liability', 'equity')
  group by a.id, a.account_number, a.account_name, a.category, a.normal_balance
  having (case a.normal_balance
            when 'debit'  then coalesce(sum(ml.debit), 0) - coalesce(sum(ml.credit), 0)
            when 'credit' then coalesce(sum(ml.credit), 0) - coalesce(sum(ml.debit), 0)
          end) <> 0
  order by a.account_number;
end;
$$;

revoke all on function get_balance_sheet(uuid, date) from public;
revoke all on function get_balance_sheet(uuid, date) from authenticated;
revoke all on function get_balance_sheet(uuid, date) from anon;
grant execute on function get_balance_sheet(uuid, date) to service_role;

-- [feature-spec-1.1.H1.md decision #3] Shared P&L / year-end signed balance.
-- Identical CASE to the historical create_year_end_closing_entry inline
-- expression — both YE and get_profit_and_loss MUST call this helper so
-- net_profit and the RE transfer cannot drift.
create or replace function account_signed_balance(
  p_normal_balance normal_balance_type,
  p_total_debit numeric,
  p_total_credit numeric
)
returns numeric(18,2)
language sql
immutable
security invoker
parallel safe
set search_path = public, pg_temp
as $$
  select case
    when p_normal_balance = 'debit' then
      round((coalesce(p_total_debit, 0) - coalesce(p_total_credit, 0))::numeric, 2)
    else
      round((coalesce(p_total_credit, 0) - coalesce(p_total_debit, 0))::numeric, 2)
  end;
$$;

revoke all on function account_signed_balance(normal_balance_type, numeric, numeric) from public;
revoke all on function account_signed_balance(normal_balance_type, numeric, numeric) from authenticated;
revoke all on function account_signed_balance(normal_balance_type, numeric, numeric) from anon;
grant execute on function account_signed_balance(normal_balance_type, numeric, numeric) to service_role;

-- [feature-spec-1.1.H1.md decision #3 / #4] Single-period P&L (no prior-period
-- comparison — deferred to H2 / build-order Extended Reports).
-- Income/expense only; entry_date in [p_period_start, p_period_end].
-- is_ledger_truth_status so originals still count when the reversing entry
-- falls outside the range (same reconstruction need as BS #2).
-- Signed balance via account_signed_balance (lockstep with year-end close).
create or replace function get_profit_and_loss(
  p_company_id uuid,
  p_period_start date,
  p_period_end date
)
returns table (
  account_id uuid,
  account_number char(4),
  account_name text,
  category account_category,
  normal_balance normal_balance_type,
  total_debit numeric(18,2),
  total_credit numeric(18,2),
  balance numeric(18,2)
)
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
begin
  if p_period_start is null or p_period_end is null then
    raise exception 'PERIOD_RANGE_REQUIRED';
  end if;

  if p_period_end < p_period_start then
    raise exception 'INVALID_PERIOD_RANGE';
  end if;

  return query
  with matched_lines as (
    select
      jl.account_id,
      jl.debit,
      jl.credit
    from journal_lines jl
    join journal_entries je on je.id = jl.journal_entry_id
    where je.company_id = p_company_id
      and is_ledger_truth_status(je.status)
      and je.entry_date >= p_period_start
      and je.entry_date <= p_period_end
  )
  select
    a.id,
    a.account_number,
    a.account_name,
    a.category,
    a.normal_balance,
    coalesce(sum(ml.debit), 0)::numeric(18,2),
    coalesce(sum(ml.credit), 0)::numeric(18,2),
    account_signed_balance(
      a.normal_balance,
      coalesce(sum(ml.debit), 0),
      coalesce(sum(ml.credit), 0)
    )
  from accounts a
  left join matched_lines ml on ml.account_id = a.id
  where a.company_id = p_company_id
    and a.category in ('income', 'expense')
  group by a.id, a.account_number, a.account_name, a.category, a.normal_balance
  having account_signed_balance(
           a.normal_balance,
           coalesce(sum(ml.debit), 0),
           coalesce(sum(ml.credit), 0)
         ) <> 0
  order by a.category, a.account_number;
end;
$$;

revoke all on function get_profit_and_loss(uuid, date, date) from public;
revoke all on function get_profit_and_loss(uuid, date, date) from authenticated;
revoke all on function get_profit_and_loss(uuid, date, date) from anon;
grant execute on function get_profit_and_loss(uuid, date, date) to service_role;

-- [feature-spec-1.1.H1.md decision #5] General Ledger — line-level listing
-- with per-account running balance. Not an aggregate report.
-- Status: is_ledger_truth_status (#4). Order: account_number, entry_date,
-- entry_number, line_number. Running balance is ALWAYS true cumulative
-- (partitioned by account); date filters only limit which rows are
-- returned — they do NOT reset the running balance to zero.
-- [feature-spec-1.1.H2.md H2-3 / H2-11] Optional p_limit / p_offset
-- (null / 0). LIMIT/OFFSET only on the outer SELECT after running
-- balance is computed. total_count is COUNT(*) over the same
-- date-filtered set. SECURITY INVOKER + §5.1 grants.
create or replace function get_general_ledger(
  p_company_id uuid,
  p_account_id uuid default null,
  p_date_from date default null,
  p_date_to date default null,
  p_limit int default null,
  p_offset int default 0
)
returns table (
  journal_line_id uuid,
  journal_entry_id uuid,
  entry_number bigint,
  entry_date date,
  narration text,
  entry_status journal_entry_status,
  account_id uuid,
  account_number char(4),
  account_name text,
  normal_balance normal_balance_type,
  line_number smallint,
  debit numeric(18,2),
  credit numeric(18,2),
  line_balance numeric(18,2),
  running_balance numeric(18,2),
  total_count bigint
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

  if p_date_from is not null and p_date_to is not null and p_date_to < p_date_from then
    raise exception 'INVALID_DATE_RANGE';
  end if;

  if p_limit is not null and p_limit < 0 then
    raise exception 'INVALID_LIMIT';
  end if;

  if p_offset is not null and p_offset < 0 then
    raise exception 'INVALID_OFFSET';
  end if;

  if p_account_id is not null then
    if not exists (
      select 1 from accounts a
       where a.id = p_account_id
         and a.company_id = p_company_id
    ) then
      raise exception 'ACCOUNT_COMPANY_MISMATCH';
    end if;
  end if;

  return query
  with ledger_lines as (
    select
      jl.id as journal_line_id,
      je.id as journal_entry_id,
      je.entry_number,
      je.entry_date,
      je.narration,
      je.status as entry_status,
      a.id as account_id,
      a.account_number,
      a.account_name,
      a.normal_balance,
      jl.line_number,
      jl.debit,
      jl.credit,
      account_signed_balance(a.normal_balance, jl.debit, jl.credit) as line_balance
    from journal_lines jl
    join journal_entries je on je.id = jl.journal_entry_id
    join accounts a on a.id = jl.account_id
    where je.company_id = p_company_id
      and a.company_id = p_company_id
      and is_ledger_truth_status(je.status)
      and (p_account_id is null or jl.account_id = p_account_id)
  ),
  with_running as (
    select
      ll.*,
      sum(ll.line_balance) over (
        partition by ll.account_id
        order by ll.entry_date, ll.entry_number, ll.line_number
        rows between unbounded preceding and current row
      )::numeric(18,2) as running_balance
    from ledger_lines ll
  ),
  filtered as (
    select
      wr.*,
      count(*) over () as total_count
    from with_running wr
    where (p_date_from is null or wr.entry_date >= p_date_from)
      and (p_date_to is null or wr.entry_date <= p_date_to)
  )
  select
    f.journal_line_id,
    f.journal_entry_id,
    f.entry_number,
    f.entry_date,
    f.narration,
    f.entry_status,
    f.account_id,
    f.account_number,
    f.account_name,
    f.normal_balance,
    f.line_number,
    f.debit,
    f.credit,
    f.line_balance,
    f.running_balance,
    f.total_count
  from filtered f
  order by f.account_number, f.entry_date, f.entry_number, f.line_number
  offset coalesce(p_offset, 0)
  limit p_limit;
end;
$$;

revoke all on function get_general_ledger(uuid, uuid, date, date, int, int) from public;
revoke all on function get_general_ledger(uuid, uuid, date, date, int, int) from authenticated;
revoke all on function get_general_ledger(uuid, uuid, date, date, int, int) from anon;
grant execute on function get_general_ledger(uuid, uuid, date, date, int, int) to service_role;

-- ============================================================================
-- 9a1b. Module 1.1.H2 extended reports (feature-spec-1.1.H2.md H2-1…H2-5)
-- SECURITY INVOKER + §5.1 grants. No new tables.
-- ============================================================================

-- [feature-spec-1.1.H2.md H2-1 / H2-9] P&L comparison: call
-- get_profit_and_loss twice, FULL OUTER JOIN on account_id, missing
-- side coalesced to 0. Do not copy the P&L CTE.
create or replace function get_profit_and_loss_comparison(
  p_company_id uuid,
  p_period_a_start date,
  p_period_a_end date,
  p_period_b_start date,
  p_period_b_end date
)
returns table (
  account_id uuid,
  account_number char(4),
  account_name text,
  category account_category,
  normal_balance normal_balance_type,
  period_a_total_debit numeric(18,2),
  period_a_total_credit numeric(18,2),
  period_a_balance numeric(18,2),
  period_b_total_debit numeric(18,2),
  period_b_total_credit numeric(18,2),
  period_b_balance numeric(18,2),
  variance numeric(18,2)
)
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
begin
  if p_company_id is null
     or p_period_a_start is null or p_period_a_end is null
     or p_period_b_start is null or p_period_b_end is null then
    raise exception 'PERIOD_RANGE_REQUIRED';
  end if;

  if p_period_a_end < p_period_a_start or p_period_b_end < p_period_b_start then
    raise exception 'INVALID_PERIOD_RANGE';
  end if;

  return query
  with period_a as (
    select * from get_profit_and_loss(p_company_id, p_period_a_start, p_period_a_end)
  ),
  period_b as (
    select * from get_profit_and_loss(p_company_id, p_period_b_start, p_period_b_end)
  )
  select
    coalesce(a.account_id, b.account_id),
    coalesce(a.account_number, b.account_number),
    coalesce(a.account_name, b.account_name),
    coalesce(a.category, b.category),
    coalesce(a.normal_balance, b.normal_balance),
    coalesce(a.total_debit, 0)::numeric(18,2),
    coalesce(a.total_credit, 0)::numeric(18,2),
    coalesce(a.balance, 0)::numeric(18,2),
    coalesce(b.total_debit, 0)::numeric(18,2),
    coalesce(b.total_credit, 0)::numeric(18,2),
    coalesce(b.balance, 0)::numeric(18,2),
    (coalesce(a.balance, 0) - coalesce(b.balance, 0))::numeric(18,2)
  from period_a a
  full outer join period_b b on b.account_id = a.account_id
  order by coalesce(a.category, b.category), coalesce(a.account_number, b.account_number);
end;
$$;

revoke all on function get_profit_and_loss_comparison(uuid, date, date, date, date) from public;
revoke all on function get_profit_and_loss_comparison(uuid, date, date, date, date) from authenticated;
revoke all on function get_profit_and_loss_comparison(uuid, date, date, date, date) from anon;
grant execute on function get_profit_and_loss_comparison(uuid, date, date, date, date) to service_role;

-- [feature-spec-1.1.H2.md H2-2 / H2-10] Range TB — same opening/closing
-- definitions as get_trial_balance_for_period, keyed on caller dates.
create or replace function get_trial_balance_for_range(
  p_company_id uuid,
  p_range_start date,
  p_range_end date,
  p_include_zero_balance boolean default false
)
returns table (
  account_id uuid,
  account_number char(4),
  account_name text,
  category account_category,
  normal_balance normal_balance_type,
  opening_debit numeric(18,2),
  opening_credit numeric(18,2),
  opening_balance numeric(18,2),
  period_debit numeric(18,2),
  period_credit numeric(18,2),
  closing_debit numeric(18,2),
  closing_credit numeric(18,2),
  closing_balance numeric(18,2)
)
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
begin
  if p_company_id is null or p_range_start is null or p_range_end is null then
    raise exception 'PERIOD_RANGE_REQUIRED';
  end if;

  if p_range_end < p_range_start then
    raise exception 'INVALID_PERIOD_RANGE';
  end if;

  return query
  with opening as (
    select
      jl.account_id,
      coalesce(sum(jl.debit), 0)::numeric(18,2) as debit,
      coalesce(sum(jl.credit), 0)::numeric(18,2) as credit
    from journal_lines jl
    join journal_entries je on je.id = jl.journal_entry_id
    where je.company_id = p_company_id
      and is_ledger_truth_status(je.status)
      and je.entry_date < p_range_start
    group by jl.account_id
  ),
  period_act as (
    select
      jl.account_id,
      coalesce(sum(jl.debit), 0)::numeric(18,2) as debit,
      coalesce(sum(jl.credit), 0)::numeric(18,2) as credit
    from journal_lines jl
    join journal_entries je on je.id = jl.journal_entry_id
    where je.company_id = p_company_id
      and is_ledger_truth_status(je.status)
      and je.entry_date >= p_range_start
      and je.entry_date <= p_range_end
    group by jl.account_id
  )
  select
    a.id,
    a.account_number,
    a.account_name,
    a.category,
    a.normal_balance,
    coalesce(o.debit, 0)::numeric(18,2),
    coalesce(o.credit, 0)::numeric(18,2),
    (case a.normal_balance
      when 'debit'  then coalesce(o.debit, 0) - coalesce(o.credit, 0)
      when 'credit' then coalesce(o.credit, 0) - coalesce(o.debit, 0)
    end)::numeric(18,2),
    coalesce(p.debit, 0)::numeric(18,2),
    coalesce(p.credit, 0)::numeric(18,2),
    (coalesce(o.debit, 0) + coalesce(p.debit, 0))::numeric(18,2),
    (coalesce(o.credit, 0) + coalesce(p.credit, 0))::numeric(18,2),
    (case a.normal_balance
      when 'debit' then
        (coalesce(o.debit, 0) + coalesce(p.debit, 0))
        - (coalesce(o.credit, 0) + coalesce(p.credit, 0))
      when 'credit' then
        (coalesce(o.credit, 0) + coalesce(p.credit, 0))
        - (coalesce(o.debit, 0) + coalesce(p.debit, 0))
    end)::numeric(18,2)
  from accounts a
  left join opening o on o.account_id = a.id
  left join period_act p on p.account_id = a.id
  where a.company_id = p_company_id
    and (
      p_include_zero_balance
      or coalesce(o.debit, 0) <> 0
      or coalesce(o.credit, 0) <> 0
      or coalesce(p.debit, 0) <> 0
      or coalesce(p.credit, 0) <> 0
    )
  order by a.account_number;
end;
$$;

revoke all on function get_trial_balance_for_range(uuid, date, date, boolean) from public;
revoke all on function get_trial_balance_for_range(uuid, date, date, boolean) from authenticated;
revoke all on function get_trial_balance_for_range(uuid, date, date, boolean) from anon;
grant execute on function get_trial_balance_for_range(uuid, date, date, boolean) to service_role;

-- [feature-spec-1.1.H2.md H2-4 / H2-12] Expense analysis — monthly
-- buckets of P&L expense balances grouped by accounts.sub_category.
create or replace function get_expense_analysis(
  p_company_id uuid,
  p_fiscal_year integer
)
returns table (
  month_start date,
  sub_category text,
  amount numeric(18,2),
  mom_delta numeric(18,2)
)
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
declare
  v_fy_start date;
  v_fy_end date;
begin
  if p_company_id is null then
    raise exception 'COMPANY_ID_REQUIRED';
  end if;
  if p_fiscal_year is null then
    raise exception 'FISCAL_YEAR_REQUIRED';
  end if;

  select min(period_start), max(period_end)
    into v_fy_start, v_fy_end
    from accounting_periods
   where company_id = p_company_id
     and fiscal_year = p_fiscal_year;
  if v_fy_end is null then
    raise exception 'NO_PERIOD_FOR_FISCAL_YEAR';
  end if;

  return query
  with months as (
    select generate_series(
      date_trunc('month', v_fy_start)::date,
      date_trunc('month', v_fy_end)::date,
      interval '1 month'
    )::date as bucket_month
  ),
  month_bounds as (
    select
      bucket_month,
      greatest(bucket_month, v_fy_start) as range_start,
      least((bucket_month + interval '1 month' - interval '1 day')::date, v_fy_end) as range_end
    from months
  ),
  monthly as (
    select
      mb.bucket_month,
      coalesce(nullif(a.sub_category, ''), 'Uncategorized') as bucket_sub,
      coalesce(sum(pnl.balance), 0)::numeric(18,2) as bucket_amount
    from month_bounds mb
    cross join lateral get_profit_and_loss(p_company_id, mb.range_start, mb.range_end) pnl
    join accounts a on a.id = pnl.account_id
    where pnl.category = 'expense'
    group by mb.bucket_month, coalesce(nullif(a.sub_category, ''), 'Uncategorized')
  ),
  subcats as (
    select distinct m.bucket_sub from monthly m
  ),
  densified as (
    select
      mb.bucket_month,
      s.bucket_sub,
      coalesce(m.bucket_amount, 0)::numeric(18,2) as bucket_amount
    from month_bounds mb
    cross join subcats s
    left join monthly m
      on m.bucket_month = mb.bucket_month
     and m.bucket_sub = s.bucket_sub
  )
  select
    d.bucket_month,
    d.bucket_sub,
    d.bucket_amount,
    (d.bucket_amount - coalesce(
      lag(d.bucket_amount) over (partition by d.bucket_sub order by d.bucket_month),
      0
    ))::numeric(18,2)
  from densified d
  order by d.bucket_sub, d.bucket_month;
end;
$$;

revoke all on function get_expense_analysis(uuid, integer) from public;
revoke all on function get_expense_analysis(uuid, integer) from authenticated;
revoke all on function get_expense_analysis(uuid, integer) from anon;
grant execute on function get_expense_analysis(uuid, integer) to service_role;

-- [feature-spec-1.1.H2.md H2-5 / H2-13 / H2-14 / H2-15] Sales by customer
-- from invoice line net on Sales Revenue (plus FZ 4300/4310/4320), net of
-- credit-note line net via credit_notes.customer_id. G-37 status filter.
-- H2-15: do not sum line_total (gross = net + VAT).
create or replace function get_sales_by_customer(
  p_company_id uuid,
  p_period_start date,
  p_period_end date
)
returns table (
  customer_id uuid,
  total_revenue numeric(18,2),
  invoice_count integer,
  average_invoice_value numeric(18,2)
)
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
begin
  if p_company_id is null or p_period_start is null or p_period_end is null then
    raise exception 'PERIOD_RANGE_REQUIRED';
  end if;

  if p_period_end < p_period_start then
    raise exception 'INVALID_PERIOD_RANGE';
  end if;

  return query
  with sales_accounts as (
    select a.id
    from accounts a
    join companies c on c.id = a.company_id
    where a.company_id = p_company_id
      and a.sub_category not in ('Investment Income', 'Other Income', 'FX & Other')
      and (
        a.sub_category = 'Sales Revenue'
        or (
          c.is_free_zone_entity
          and a.account_number in ('4300', '4310', '4320')
        )
      )
  ),
  inv as (
    select
      i.customer_id,
      coalesce(sum(line_net_amount(
        il.quantity, il.unit_price, il.discount_percent, il.discount_amount
      )), 0)::numeric(18,2) as revenue,
      count(distinct i.id)::integer as invoice_count
    from invoices i
    join invoice_lines il on il.invoice_id = i.id
    join sales_accounts sa on sa.id = il.income_account_id
    where i.company_id = p_company_id
      and i.status not in ('draft', 'void')
      and i.invoice_date >= p_period_start
      and i.invoice_date <= p_period_end
    group by i.customer_id
  ),
  cn as (
    select
      n.customer_id,
      coalesce(sum(line_net_amount(
        nl.quantity, nl.unit_price, nl.discount_percent, nl.discount_amount
      )), 0)::numeric(18,2) as credit
    from credit_notes n
    join credit_note_lines nl on nl.credit_note_id = n.id
    join sales_accounts sa on sa.id = nl.income_account_id
    where n.company_id = p_company_id
      and n.status not in ('draft', 'void')
      and n.credit_note_date >= p_period_start
      and n.credit_note_date <= p_period_end
    group by n.customer_id
  )
  select
    coalesce(inv.customer_id, cn.customer_id),
    (coalesce(inv.revenue, 0) - coalesce(cn.credit, 0))::numeric(18,2),
    coalesce(inv.invoice_count, 0),
    case
      when coalesce(inv.invoice_count, 0) = 0 then null
      else round(
        (coalesce(inv.revenue, 0) - coalesce(cn.credit, 0)) / inv.invoice_count,
        2
      )::numeric(18,2)
    end
  from inv
  full outer join cn on cn.customer_id = inv.customer_id
  order by coalesce(inv.customer_id, cn.customer_id);
end;
$$;

revoke all on function get_sales_by_customer(uuid, date, date) from public;
revoke all on function get_sales_by_customer(uuid, date, date) from authenticated;
revoke all on function get_sales_by_customer(uuid, date, date) from anon;
grant execute on function get_sales_by_customer(uuid, date, date) to service_role;

-- ============================================================================
-- 9a2. Module 1.1.D AR reports (feature-spec-1_1_D.md section 5 / D-P12)
-- [feature-spec-1_1_D.md §5 / D-P12]
-- Customer ledger, aged receivables, credit-limit check, payment history.
-- Pattern: SECURITY INVOKER + service_role EXECUTE (H1 §5.1).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §5.1 get_customer_ledger
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
-- §5.2 get_aged_receivables — D-5 buckets + totals row
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
-- §5.3 / D-4 check_customer_credit_limit — alert data only (non-blocking)
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

  -- Available unapplied advance credit: posted advance_receipt payments only (§5)
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
-- §5.5 get_customer_payment_history — paid invoices only (paid_at set)
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


-- ============================================================================
-- 9b. ADVISORY-LOCK JOURNAL RPCs (entry_number / opening balance / year-end)
-- Functions only — no table/column/constraint changes.
-- ============================================================================

-- allocate_next_entry_number
--
-- [HANDOFF §7 / race fix] Company-scoped transaction advisory lock around
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

-- insert_journal_entry_draft
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

-- create_opening_balance_entry
-- [feature-spec.md decision #3] One opening_balance per company per fiscal year.
-- [race fix] Lock 'ob:' namespace FIRST, then allocate_next_entry_number's
-- company-scoped lock.
-- Exception tokens: OPENING_BALANCE_ALREADY_EXISTS, NO_OPEN_PERIOD_FOR_FISCAL_YEAR,
-- OPENING_BALANCE_INVALID_ACCOUNT_CATEGORY
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

  -- [feature-spec.md §4.3 decision #57] Opening balances seed balance-sheet accounts
  -- only — income/expense lines would corrupt current-year P&L. Fail atomically before
  -- any journal_entries / journal_lines inserts. Nest uses assertOpeningBalanceAccountsUsable
  -- (shared assertAccountsUsableForCompany is not category-aware); this RPC is the DB
  -- backstop when service_role bypasses Nest (§5.1).
  for v_line in
    select value from jsonb_array_elements(p_lines) as t(value)
  loop
    if exists (
      select 1
        from accounts a
       where a.id = (v_line->>'account_id')::uuid
         and a.company_id = p_company_id
         and a.category in ('income', 'expense')
    ) then
      raise exception 'OPENING_BALANCE_INVALID_ACCOUNT_CATEGORY';
    end if;
  end loop;

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

-- create_year_end_closing_entry
-- [feature-spec.md decision #4] One year_end_closing per company per fiscal year.
-- [race fix] Lock 'ye:' namespace FIRST, then allocate_next_entry_number's
-- company-scoped lock. 'ob:' and 'ye:' namespaces do NOT block each other.
-- Exception tokens: YEAR_END_ALREADY_CLOSED, NO_PERIOD_FOR_FISCAL_YEAR,
-- RETAINED_EARNINGS_NOT_FOUND, NO_PL_BALANCES_TO_CLOSE,
-- CT_PROVISION_NOT_POSTED [feature-spec-1_1_G.md G-22 / G-32 / G-41]
-- [feature-spec.md decision #10] service_role only.
-- G-32: DROP the live five-arg overload so PostgREST cannot skip the CT check.

drop function if exists create_year_end_closing_entry(uuid, integer, uuid, date, text);

create or replace function create_year_end_closing_entry(
  p_company_id uuid,
  p_fiscal_year integer,
  p_created_by uuid,
  p_entry_date date default null,
  p_narration text default null,
  p_skip_ct_check boolean default false,
  p_skip_reason text default null
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
  v_ct_posted           boolean;
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

  -- Period must exist before the CT gate: the provision posts into the FY's
  -- last open period (G-22), so a year with no accounting_periods row is
  -- NO_PERIOD_FOR_FISCAL_YEAR, not CT_PROVISION_NOT_POSTED.
  select * into v_period
    from accounting_periods
   where company_id = p_company_id
     and fiscal_year = p_fiscal_year
   order by period_end desc
   limit 1;

  if not found then
    raise exception 'NO_PERIOD_FOR_FISCAL_YEAR';
  end if;

  -- [feature-spec-1_1_G.md G-22 / G-32 / G-41] after lock + period exists, before P&L.
  select exists (
    select 1
      from ct_provision_entries
     where company_id = p_company_id
       and fiscal_year = p_fiscal_year
       and status in ('posted', 'posted_nil')
     limit 1
  ) into v_ct_posted;

  if not v_ct_posted then
    if p_skip_ct_check is not true or btrim(coalesce(p_skip_reason, '')) = '' then
      raise exception 'CT_PROVISION_NOT_POSTED';
    end if;
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
      -- [feature-spec-1.1.H1.md decision #3 / #4] lockstep with get_profit_and_loss:
      -- same signed-balance helper and is_ledger_truth_status (posted ∪ reversed).
      -- posted-only would drop reversed originals while keeping reversing entries,
      -- producing a wrong RE transfer after mid-year reversals (H1-5 sweep).
      account_signed_balance(a.normal_balance, sum(jl.debit), sum(jl.credit)) as balance
    from journal_lines jl
    join journal_entries je on je.id = jl.journal_entry_id
    join accounting_periods ap on ap.id = je.period_id
    join accounts a on a.id = jl.account_id
   where je.company_id = p_company_id
     and is_ledger_truth_status(je.status)
     and ap.fiscal_year = p_fiscal_year
     and a.category in ('income', 'expense')
   group by a.id, a.category, a.normal_balance
  having account_signed_balance(a.normal_balance, sum(jl.debit), sum(jl.credit)) <> 0
  loop
    if r.category = 'income' then
      insert into tmp_ye_lines(line_number, account_id, debit, credit, description)
      values (v_line_number, r.account_id, r.balance, 0, 'Year-end close — zero income balance');
      v_total_debits := v_total_debits + r.balance;
      v_line_number := v_line_number + 1;
    elsif r.category = 'expense' then
      insert into tmp_ye_lines(line_number, account_id, debit, credit, description)
      values (v_line_number, r.account_id, 0, r.balance, 'Year-end close — zero expense balance');
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
    values (v_line_number, v_re_id, 0, v_net, 'Year-end close — net P&L to Retained Earnings');
  elsif v_net < 0 then
    insert into tmp_ye_lines(line_number, account_id, debit, credit, description)
    values (v_line_number, v_re_id, abs(v_net), 0, 'Year-end close — net P&L to Retained Earnings');
  end if;

  v_entry_date := coalesce(p_entry_date, v_period.period_end);
  v_narration := coalesce(
    nullif(trim(p_narration), ''),
    format('Year-end closing for fiscal year %s', p_fiscal_year)
  );
  -- [feature-spec-1_1_G.md G-32] prepend skip reason onto YE narration.
  if not v_ct_posted and p_skip_ct_check is true then
    v_narration := '[CT skip: ' || btrim(p_skip_reason) || '] ' || v_narration;
  end if;

  v_entry_number := allocate_next_entry_number(p_company_id);

  insert into journal_entries (
    company_id, entry_number, period_id, entry_date, entry_type, status, narration, created_by
  ) values (
    p_company_id, v_entry_number, v_period.id, v_entry_date, 'year_end_closing', 'draft', v_narration, p_created_by
  )
  returning * into v_entry;

  insert into journal_lines (journal_entry_id, line_number, account_id, debit, credit, description)
  select v_entry.id, t.line_number, t.account_id, t.debit, t.credit, t.description
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

revoke all on function create_year_end_closing_entry(uuid, integer, uuid, date, text, boolean, text) from public;
revoke all on function create_year_end_closing_entry(uuid, integer, uuid, date, text, boolean, text) from authenticated;
revoke all on function create_year_end_closing_entry(uuid, integer, uuid, date, text, boolean, text) from anon;
grant execute on function create_year_end_closing_entry(uuid, integer, uuid, date, text, boolean, text) to service_role;

-- ============================================================================
-- MODULE G — UAE Corporate Tax RPCs (feature-spec-1_1_G.md §4)
-- ============================================================================

-- Internal helpers (not Nest-facing). Named spec functions below.

create or replace function ct_account_fy_signed(
  p_company_id uuid,
  p_fiscal_year integer,
  p_account_number char(4)
)
returns numeric(18,2)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce((
    select account_signed_balance(
             a.normal_balance,
             coalesce(x.total_debit, 0),
             coalesce(x.total_credit, 0)
           )
      from accounts a
      left join (
        select jl.account_id,
               sum(jl.debit) as total_debit,
               sum(jl.credit) as total_credit
          from journal_lines jl
          join journal_entries je on je.id = jl.journal_entry_id
          join accounting_periods ap on ap.id = je.period_id
         where je.company_id = p_company_id
           and is_ledger_truth_status(je.status)
           and ap.fiscal_year = p_fiscal_year
         group by jl.account_id
      ) x on x.account_id = a.id
     where a.company_id = p_company_id
       and a.account_number = p_account_number
  ), 0)::numeric(18,2);
$$;
revoke all on function ct_account_fy_signed(uuid, integer, char) from public;
revoke all on function ct_account_fy_signed(uuid, integer, char) from authenticated;
revoke all on function ct_account_fy_signed(uuid, integer, char) from anon;
grant execute on function ct_account_fy_signed(uuid, integer, char) to service_role;

create or replace function ct_fy_net_profit(
  p_company_id uuid,
  p_fiscal_year integer
)
returns numeric(18,2)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(sum(
    case
      when a.category = 'income' then account_signed_balance(
        a.normal_balance, coalesce(x.total_debit, 0), coalesce(x.total_credit, 0))
      when a.category = 'expense' then -account_signed_balance(
        a.normal_balance, coalesce(x.total_debit, 0), coalesce(x.total_credit, 0))
      else 0
    end
  ), 0)::numeric(18,2)
    from accounts a
    left join (
      select jl.account_id,
             sum(jl.debit) as total_debit,
             sum(jl.credit) as total_credit
        from journal_lines jl
        join journal_entries je on je.id = jl.journal_entry_id
        join accounting_periods ap on ap.id = je.period_id
       where je.company_id = p_company_id
         and is_ledger_truth_status(je.status)
         and ap.fiscal_year = p_fiscal_year
       group by jl.account_id
    ) x on x.account_id = a.id
   where a.company_id = p_company_id
     and a.category in ('income', 'expense');
$$;
revoke all on function ct_fy_net_profit(uuid, integer) from public;
revoke all on function ct_fy_net_profit(uuid, integer) from authenticated;
revoke all on function ct_fy_net_profit(uuid, integer) from anon;
grant execute on function ct_fy_net_profit(uuid, integer) to service_role;

create or replace function ct_fy_revenue(
  p_company_id uuid,
  p_fiscal_year integer
)
returns numeric(18,2)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(sum(
    account_signed_balance(
      a.normal_balance, coalesce(x.total_debit, 0), coalesce(x.total_credit, 0))
  ), 0)::numeric(18,2)
    from accounts a
    left join (
      select jl.account_id,
             sum(jl.debit) as total_debit,
             sum(jl.credit) as total_credit
        from journal_lines jl
        join journal_entries je on je.id = jl.journal_entry_id
        join accounting_periods ap on ap.id = je.period_id
       where je.company_id = p_company_id
         and is_ledger_truth_status(je.status)
         and ap.fiscal_year = p_fiscal_year
       group by jl.account_id
    ) x on x.account_id = a.id
   where a.company_id = p_company_id
     and a.category = 'income';
$$;
revoke all on function ct_fy_revenue(uuid, integer) from public;
revoke all on function ct_fy_revenue(uuid, integer) from authenticated;
revoke all on function ct_fy_revenue(uuid, integer) from anon;
grant execute on function ct_fy_revenue(uuid, integer) to service_role;

-- [feature-spec-1_1_G.md §4.4 / G-17 / G-23]
create or replace function check_small_business_relief_eligibility(
  p_company_id uuid,
  p_fiscal_year integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule ct_tax_rule_versions%rowtype;
  v_fy_end date;
  v_sunset_ok boolean;
  v_cap_ok boolean := true;
  v_history jsonb := '[]'::jsonb;
  r record;
begin
  select max(period_end) into v_fy_end
    from accounting_periods
   where company_id = p_company_id
     and fiscal_year = p_fiscal_year;
  if v_fy_end is null then
    raise exception 'NO_PERIOD_FOR_FISCAL_YEAR';
  end if;

  select * into v_rule
    from ct_tax_rule_versions
   where effective_from <= v_fy_end
   order by effective_from desc
   limit 1;
  if not found then
    raise exception 'CT_TAX_RULE_NOT_FOUND';
  end if;

  v_sunset_ok := v_fy_end <= v_rule.sbr_eligible_through;

  for r in
    select fy, ct_fy_revenue(p_company_id, fy) as revenue
      from (
        select distinct fiscal_year as fy
          from accounting_periods
         where company_id = p_company_id
           and fiscal_year <= p_fiscal_year
      ) y
     order by fy
  loop
    v_history := v_history || jsonb_build_array(jsonb_build_object(
      'fiscal_year', r.fy,
      'revenue', r.revenue,
      'exceeds_cap', r.revenue > v_rule.sbr_revenue_cap
    ));
    if r.revenue > v_rule.sbr_revenue_cap then
      v_cap_ok := false;
    end if;
  end loop;

  return jsonb_build_object(
    'eligible', v_sunset_ok and v_cap_ok,
    'sunset_ok', v_sunset_ok,
    'revenue_cap_ok', v_cap_ok,
    'sbr_eligible_through', v_rule.sbr_eligible_through,
    'sbr_revenue_cap', v_rule.sbr_revenue_cap,
    'period_end', v_fy_end,
    'rule_id', v_rule.id,
    'revenue_history', v_history
  );
end;
$$;
revoke all on function check_small_business_relief_eligibility(uuid, integer) from public;
revoke all on function check_small_business_relief_eligibility(uuid, integer) from authenticated;
revoke all on function check_small_business_relief_eligibility(uuid, integer) from anon;
grant execute on function check_small_business_relief_eligibility(uuid, integer) to service_role;

-- [feature-spec-1_1_G.md §4.1 / §4.2 / G-2 / G-15 / G-18 / G-24]
create or replace function get_ct_taxable_profit_estimate(
  p_company_id uuid,
  p_fiscal_year integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule ct_tax_rule_versions%rowtype;
  v_fy_end date;
  v_is_fz boolean;
  v_net numeric(18,2);
  v_ent numeric(18,2);
  v_other numeric(18,2) := 0;
  v_exempt numeric(18,2);
  v_qi numeric(18,2);
  v_nqi numeric(18,2);
  v_tp numeric(18,2);
  v_due numeric(18,2);
  v_acct text;
  v_sbr jsonb;
begin
  select max(period_end) into v_fy_end
    from accounting_periods
   where company_id = p_company_id
     and fiscal_year = p_fiscal_year;
  if v_fy_end is null then
    raise exception 'NO_PERIOD_FOR_FISCAL_YEAR';
  end if;

  select * into v_rule
    from ct_tax_rule_versions
   where effective_from <= v_fy_end
   order by effective_from desc
   limit 1;
  if not found then
    raise exception 'CT_TAX_RULE_NOT_FOUND';
  end if;

  select is_free_zone_entity into v_is_fz
    from companies
   where id = p_company_id;
  if not found then
    raise exception 'COMPANY_NOT_FOUND';
  end if;

  v_net := ct_fy_net_profit(p_company_id, p_fiscal_year);
  v_ent := round(
    ct_account_fy_signed(p_company_id, p_fiscal_year, '5580')
      * v_rule.entertainment_addback_pct / 100
  , 2);
  foreach v_acct in array v_rule.other_addback_accounts
  loop
    v_other := v_other + ct_account_fy_signed(p_company_id, p_fiscal_year, v_acct::char(4));
  end loop;
  v_other := round(v_other, 2);

  select coalesce(sum(amount), 0) into v_exempt
    from ct_income_adjustments
   where company_id = p_company_id
     and fiscal_year = p_fiscal_year
     and adjustment_type in ('qualifying_dividend', 'intragroup_transaction');

  v_qi := case when v_is_fz then ct_account_fy_signed(p_company_id, p_fiscal_year, '4300') else 0 end;
  v_nqi := case when v_is_fz then
    ct_account_fy_signed(p_company_id, p_fiscal_year, '4310')
    + ct_account_fy_signed(p_company_id, p_fiscal_year, '4320')
  else 0 end;

  -- [feature-spec-1_1_G.md §4.1] TP = net + add-backs − exempt − QI (FZ only).
  v_tp := round((v_net + v_ent + v_other - v_exempt - v_qi)::numeric, 2);

  -- [feature-spec-1_1_G.md G-15 / G-34] QFZP: (QI×qfzp_rate)+(NQI×standard_rate), no 375k band.
  if v_is_fz then
    v_due := round(
      (v_qi * v_rule.qfzp_rate / 100) + (v_nqi * v_rule.standard_rate / 100)
    , 2);
  else
    v_due := round(greatest(0, v_tp - v_rule.zero_rate_threshold) * v_rule.standard_rate / 100, 2);
  end if;

  v_sbr := check_small_business_relief_eligibility(p_company_id, p_fiscal_year);

  return jsonb_build_object(
    'fiscal_year', p_fiscal_year,
    'is_qfzp_calculation', v_is_fz,
    'net_profit', v_net,
    'entertainment_addback', v_ent,
    'other_addback', v_other,
    'exempt_income_exclusions', v_exempt,
    'qualifying_income', v_qi,
    'non_qualifying_income', v_nqi,
    'taxable_profit_estimate', v_tp,
    'ct_due', v_due,
    'zero_rate_threshold', v_rule.zero_rate_threshold,
    'standard_rate', v_rule.standard_rate,
    'qfzp_rate', v_rule.qfzp_rate,
    'alert_threshold_pct', v_rule.alert_threshold_pct,
    -- [feature-spec-1_1_G.md G-35] threshold × alert_threshold_pct / 100 at read time; never hardcoded.
    'threshold_alert', (not v_is_fz) and v_tp >= round(v_rule.zero_rate_threshold * v_rule.alert_threshold_pct / 100, 2),
    'sbr_eligible', (v_sbr->>'eligible')::boolean,
    'rule_id', v_rule.id
  );
end;
$$;
revoke all on function get_ct_taxable_profit_estimate(uuid, integer) from public;
revoke all on function get_ct_taxable_profit_estimate(uuid, integer) from authenticated;
revoke all on function get_ct_taxable_profit_estimate(uuid, integer) from anon;
grant execute on function get_ct_taxable_profit_estimate(uuid, integer) to service_role;

-- [feature-spec-1_1_G.md §4.3 / G-1 / G-13 / G-15 / G-22 / G-23 / G-33 / G-41]
create or replace function create_ct_provision_entry(
  p_company_id uuid,
  p_fiscal_year integer,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_est jsonb;
  v_period accounting_periods%rowtype;
  v_due numeric(18,2);
  v_fy_end date;
  v_due_date date;
  v_dr uuid;
  v_cr uuid;
  v_entry_number bigint;
  v_entry journal_entries%rowtype;
  v_row ct_provision_entries%rowtype;
  v_status ct_provision_status;
begin
  if p_created_by is null then
    raise exception 'CREATED_BY_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('ct:' || p_company_id::text || ':' || p_fiscal_year::text)
  );

  if exists (
    select 1 from ct_provision_entries
     where company_id = p_company_id
       and fiscal_year = p_fiscal_year
       and status in ('posted', 'posted_nil')
  ) then
    raise exception 'CT_PROVISION_ALREADY_POSTED';
  end if;

  select * into v_period
    from accounting_periods
   where company_id = p_company_id
     and fiscal_year = p_fiscal_year
     and status = 'open'
   order by period_end desc
   limit 1;
  if not found then
    raise exception 'NO_OPEN_PERIOD_FOR_FISCAL_YEAR';
  end if;

  select max(period_end) into v_fy_end
    from accounting_periods
   where company_id = p_company_id
     and fiscal_year = p_fiscal_year;
  v_due_date := (v_fy_end + interval '9 months')::date;

  v_est := get_ct_taxable_profit_estimate(p_company_id, p_fiscal_year);
  v_due := (v_est->>'ct_due')::numeric(18,2);

  v_dr := account_id_by_number(p_company_id, '5830', true);
  v_cr := account_id_by_number(p_company_id, '2300', true);
  if v_dr is null or v_cr is null then
    raise exception 'CT_POSTING_ACCOUNT_NOT_FOUND';
  end if;

  -- [feature-spec-1_1_G.md G-41] ct_due = 0 → posted_nil, no JE (journal_lines debit XOR credit > 0).
  if v_due > 0 then
    v_status := 'posted';
    v_entry_number := allocate_next_entry_number(p_company_id);
    insert into journal_entries (
      company_id, entry_number, period_id, entry_date, entry_type, status,
      narration, created_by
    ) values (
      p_company_id, v_entry_number, v_period.id, v_period.period_end, 'ct_provision', 'draft',
      format('CT provision fiscal year %s', p_fiscal_year), p_created_by
    ) returning * into v_entry;

    insert into journal_lines (journal_entry_id, line_number, account_id, debit, credit, description)
    values
      (v_entry.id, 1, v_dr, v_due, 0, 'CT expense (5830)'),
      (v_entry.id, 2, v_cr, 0, v_due, 'CT payable / provision (2300)');

    update journal_entries
       set status = 'posted'
     where id = v_entry.id and status = 'draft'
    returning * into v_entry;
    if not found then
      raise exception 'Failed to post CT provision entry %', v_entry_number;
    end if;
  else
    v_status := 'posted_nil';
  end if;

  insert into ct_provision_entries (
    company_id, fiscal_year, taxable_profit_estimate, is_qfzp_calculation,
    sbr_eligible, ct_due, payment_due_date, status,
    provision_journal_entry_id, posted_at, posted_by
  ) values (
    p_company_id, p_fiscal_year,
    (v_est->>'taxable_profit_estimate')::numeric,
    (v_est->>'is_qfzp_calculation')::boolean,
    (v_est->>'sbr_eligible')::boolean,
    v_due, v_due_date, v_status,
    v_entry.id, now(), p_created_by -- [feature-spec-1_1_G.md G-33]
  ) returning * into v_row;

  return jsonb_build_object(
    'provision', to_jsonb(v_row),
    'estimate', v_est,
    'entry', case when v_status = 'posted' then to_jsonb(v_entry) else null end
  );
end;
$$;
revoke all on function create_ct_provision_entry(uuid, integer, uuid) from public;
revoke all on function create_ct_provision_entry(uuid, integer, uuid) from authenticated;
revoke all on function create_ct_provision_entry(uuid, integer, uuid) from anon;
grant execute on function create_ct_provision_entry(uuid, integer, uuid) to service_role;

-- [feature-spec-1_1_G.md §4.6 / G-16 / G-24 / G-30 / G-37]
create or replace function summarize_free_zone_income(
  p_company_id uuid,
  p_fiscal_year integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_fz boolean;
  v_rule ct_tax_rule_versions%rowtype;
  v_fy_start date;
  v_fy_end date;
  v_revenue numeric(18,2);
  v_qi numeric(18,2) := 0;
  v_nqi numeric(18,2) := 0;
  v_threshold numeric(18,2);
begin
  select is_free_zone_entity into v_is_fz
    from companies where id = p_company_id;
  if not found then
    raise exception 'COMPANY_NOT_FOUND';
  end if;

  select min(period_start), max(period_end)
    into v_fy_start, v_fy_end
    from accounting_periods
   where company_id = p_company_id
     and fiscal_year = p_fiscal_year;
  if v_fy_end is null then
    raise exception 'NO_PERIOD_FOR_FISCAL_YEAR';
  end if;

  if not v_is_fz then
    return jsonb_build_object(
      'applicable', false,
      'qualifying_income', 0,
      'non_qualifying_income', 0,
      'revenue', ct_fy_revenue(p_company_id, p_fiscal_year),
      'deminimis_threshold', null,
      'deminimis_breach', false
    );
  end if;

  select * into v_rule
    from ct_tax_rule_versions
   where effective_from <= v_fy_end
   order by effective_from desc
   limit 1;
  if not found then
    raise exception 'CT_TAX_RULE_NOT_FOUND';
  end if;

  v_revenue := ct_fy_revenue(p_company_id, p_fiscal_year);

  select
    coalesce(sum(case when a.account_number = '4300' then il.line_total else 0 end), 0),
    coalesce(sum(case when a.account_number in ('4310', '4320') then il.line_total else 0 end), 0)
    into v_qi, v_nqi
    from invoice_lines il
    join invoices i on i.id = il.invoice_id
    join accounts a on a.id = il.income_account_id
   where i.company_id = p_company_id
     and i.invoice_date >= v_fy_start
     and i.invoice_date <= v_fy_end
     -- [feature-spec-1_1_G.md G-37] exclude draft/void — not realized / cancelled.
     and i.status not in ('draft', 'void');

  v_threshold := least(
    round(v_revenue * v_rule.qfzp_deminimis_pct / 100, 2),
    v_rule.qfzp_deminimis_cap
  );

  return jsonb_build_object(
    'applicable', true,
    'qualifying_income', v_qi,
    'non_qualifying_income', v_nqi,
    'revenue', v_revenue,
    'deminimis_threshold', v_threshold,
    'deminimis_breach', v_nqi > v_threshold
  );
end;
$$;
revoke all on function summarize_free_zone_income(uuid, integer) from public;
revoke all on function summarize_free_zone_income(uuid, integer) from authenticated;
revoke all on function summarize_free_zone_income(uuid, integer) from anon;
grant execute on function summarize_free_zone_income(uuid, integer) to service_role;

-- [feature-spec-1_1_G.md §4.7 / G-7 / G-26] insert-only.
create or replace function record_related_party_transaction(
  p_company_id uuid,
  p_counterparty_name text,
  p_relationship related_party_relationship,
  p_transaction_type text,
  p_amount numeric,
  p_transaction_date date,
  p_reference_journal_entry_id uuid default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row related_party_transactions%rowtype;
begin
  if p_counterparty_name is null or btrim(p_counterparty_name) = '' then
    raise exception 'COUNTERPARTY_NAME_REQUIRED';
  end if;
  if p_transaction_type is null or btrim(p_transaction_type) = '' then
    raise exception 'TRANSACTION_TYPE_REQUIRED';
  end if;
  if p_amount is null then
    raise exception 'AMOUNT_REQUIRED';
  end if;
  if p_transaction_date is null then
    raise exception 'TRANSACTION_DATE_REQUIRED';
  end if;

  insert into related_party_transactions (
    company_id, counterparty_name, relationship, transaction_type,
    amount, transaction_date, reference_journal_entry_id, notes
  ) values (
    p_company_id, btrim(p_counterparty_name), p_relationship, btrim(p_transaction_type),
    p_amount, p_transaction_date, p_reference_journal_entry_id, p_notes
  ) returning * into v_row;

  return to_jsonb(v_row);
end;
$$;
revoke all on function record_related_party_transaction(uuid, text, related_party_relationship, text, numeric, date, uuid, text) from public;
revoke all on function record_related_party_transaction(uuid, text, related_party_relationship, text, numeric, date, uuid, text) from authenticated;
revoke all on function record_related_party_transaction(uuid, text, related_party_relationship, text, numeric, date, uuid, text) from anon;
grant execute on function record_related_party_transaction(uuid, text, related_party_relationship, text, numeric, date, uuid, text) to service_role;

-- [feature-spec-1_1_G.md §4.8 / G-8]
create or replace function prepare_ct_return_summary(
  p_company_id uuid,
  p_fiscal_year integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_provision jsonb;
  v_sbr jsonb;
  v_fz jsonb;
  v_rp_count int;
  v_rp_total numeric(18,2);
  v_est jsonb;
begin
  select to_jsonb(p) into v_provision
    from ct_provision_entries p
   where p.company_id = p_company_id
     and p.fiscal_year = p_fiscal_year;

  v_est := get_ct_taxable_profit_estimate(p_company_id, p_fiscal_year);
  v_sbr := check_small_business_relief_eligibility(p_company_id, p_fiscal_year);
  v_fz := summarize_free_zone_income(p_company_id, p_fiscal_year);

  select count(*), coalesce(sum(amount), 0)
    into v_rp_count, v_rp_total
    from related_party_transactions
   where company_id = p_company_id
     and extract(year from transaction_date)::int = p_fiscal_year;

  return jsonb_build_object(
    'fiscal_year', p_fiscal_year,
    'provision', v_provision,
    'estimate', v_est,
    'sbr', v_sbr,
    'free_zone', v_fz,
    'related_party', jsonb_build_object(
      'count', v_rp_count,
      'total_amount', v_rp_total
    )
  );
end;
$$;
revoke all on function prepare_ct_return_summary(uuid, integer) from public;
revoke all on function prepare_ct_return_summary(uuid, integer) from authenticated;
revoke all on function prepare_ct_return_summary(uuid, integer) from anon;
grant execute on function prepare_ct_return_summary(uuid, integer) to service_role;

-- [feature-spec-1_1_G.md §4.11 / G-12]
create or replace function check_ct_penalty_exposure(
  p_company_id uuid,
  p_fiscal_year integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row ct_provision_entries%rowtype;
begin
  select * into v_row
    from ct_provision_entries
   where company_id = p_company_id
     and fiscal_year = p_fiscal_year
     and status = 'posted';
  if not found then
    return jsonb_build_object(
      'has_posted_provision', false,
      'overdue', false,
      'payment_due_date', null,
      'days_overdue', 0
    );
  end if;

  return jsonb_build_object(
    'has_posted_provision', true,
    'overdue', v_row.payment_due_date < current_date,
    'payment_due_date', v_row.payment_due_date,
    'days_overdue', greatest(0, (current_date - v_row.payment_due_date)),
    'ct_due', v_row.ct_due
  );
end;
$$;
revoke all on function check_ct_penalty_exposure(uuid, integer) from public;
revoke all on function check_ct_penalty_exposure(uuid, integer) from authenticated;
revoke all on function check_ct_penalty_exposure(uuid, integer) from anon;
grant execute on function check_ct_penalty_exposure(uuid, integer) to service_role;

-- ============================================================================
-- 9c. RECURRING DUE GENERATION RPC (advisory lock + claim next_run_date)
-- [feature-spec.md decision #63] Closes the TOCTOU race #62 flagged:
-- findDueTemplates snapshot → insert → updateSchedule were separate
-- transactions. Lock namespace `rjt:` + template_id (per-template; does not
-- serialize different templates). Lock order: rjt: first, then nested
-- allocate_next_entry_number company lock via insert_journal_entry_draft.
-- ============================================================================

-- Advance helper — lockstep with Nest advanceNextRunDate (recurring-run-date.util.ts).
create or replace function advance_recurring_next_run_date(
  p_current date,
  p_frequency recurrence_frequency,
  p_day_of_month smallint default null
)
returns date
language plpgsql
immutable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_next date;
  v_day int;
  v_last int;
  v_y int;
  v_m int;
begin
  if p_current is null then
    raise exception 'CURRENT_RUN_DATE_REQUIRED';
  end if;

  case p_frequency
    when 'daily' then
      return p_current + 1;
    when 'weekly' then
      return p_current + 7;
    when 'monthly' then
      v_day := coalesce(p_day_of_month, extract(day from p_current)::int);
      v_next := (date_trunc('month', p_current) + interval '1 month')::date;
      v_y := extract(year from v_next)::int;
      v_m := extract(month from v_next)::int;
      v_last := extract(day from (date_trunc('month', v_next) + interval '1 month - 1 day')::date)::int;
      return make_date(v_y, v_m, least(v_day, v_last));
    when 'quarterly' then
      return (p_current + interval '3 months')::date;
    when 'annually' then
      return (p_current + interval '1 year')::date;
    else
      raise exception 'UNKNOWN_RECURRENCE_FREQUENCY';
  end case;
end;
$$;

revoke all on function advance_recurring_next_run_date(date, recurrence_frequency, smallint) from public;
revoke all on function advance_recurring_next_run_date(date, recurrence_frequency, smallint) from authenticated;
revoke all on function advance_recurring_next_run_date(date, recurrence_frequency, smallint) from anon;
grant execute on function advance_recurring_next_run_date(date, recurrence_frequency, smallint) to service_role;

-- generate_due_recurring_entry
-- Atomic: rjt: lock → re-read next_run_date → skip if not due → draft insert
-- → advance schedule. Posting stays in Nest (#52).
-- Exception tokens: TEMPLATE_NOT_FOUND; skip reasons returned in JSON
-- (not raised) for TEMPLATE_NOT_DUE / inactive / no lines / no period.
create or replace function generate_due_recurring_entry(
  p_template_id uuid,
  p_as_of_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_template       recurring_journal_templates%rowtype;
  v_period         accounting_periods%rowtype;
  v_lines_json     jsonb;
  v_draft          jsonb;
  v_prev_next      date;
  v_new_next       date;
  v_still_active   boolean;
begin
  if p_template_id is null then
    raise exception 'TEMPLATE_ID_REQUIRED';
  end if;
  if p_as_of_date is null then
    raise exception 'AS_OF_DATE_REQUIRED';
  end if;

  -- [feature-spec.md decision #63 / #20] Namespace lock BEFORE nested allocator.
  perform pg_advisory_xact_lock(hashtext('rjt:' || p_template_id::text));

  select * into v_template
    from recurring_journal_templates
   where id = p_template_id;

  if not found then
    raise exception 'TEMPLATE_NOT_FOUND';
  end if;

  if not v_template.is_active then
    return jsonb_build_object(
      'skipped', true,
      'skip_reason', 'TEMPLATE_INACTIVE',
      'template_id', v_template.id,
      'next_run_date', to_jsonb(v_template.next_run_date)
    );
  end if;

  -- Re-read under lock: concurrent winner already advanced → skip.
  if v_template.next_run_date > p_as_of_date then
    return jsonb_build_object(
      'skipped', true,
      'skip_reason', 'TEMPLATE_NOT_DUE',
      'template_id', v_template.id,
      'next_run_date', to_jsonb(v_template.next_run_date)
    );
  end if;

  if v_template.end_date is not null
     and v_template.next_run_date > v_template.end_date then
    return jsonb_build_object(
      'skipped', true,
      'skip_reason', 'TEMPLATE_PAST_END_DATE',
      'template_id', v_template.id,
      'next_run_date', to_jsonb(v_template.next_run_date)
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'line_number', jl.line_number,
        'account_id', jl.account_id,
        'debit', jl.debit,
        'credit', jl.credit,
        'description', jl.description
      )
      order by jl.line_number
    ),
    '[]'::jsonb
  )
    into v_lines_json
    from recurring_journal_template_lines jl
   where jl.template_id = v_template.id;

  if v_lines_json is null or jsonb_array_length(v_lines_json) = 0 then
    return jsonb_build_object(
      'skipped', true,
      'skip_reason', 'TEMPLATE_HAS_NO_LINES',
      'template_id', v_template.id,
      'next_run_date', to_jsonb(v_template.next_run_date)
    );
  end if;

  select * into v_period
    from accounting_periods
   where company_id = v_template.company_id
     and status = 'open'
     and period_start <= v_template.next_run_date
     and period_end >= v_template.next_run_date
   order by period_start
   limit 1;

  if not found then
    return jsonb_build_object(
      'skipped', true,
      'skip_reason', 'NO_OPEN_PERIOD_FOR_RUN_DATE',
      'template_id', v_template.id,
      'next_run_date', to_jsonb(v_template.next_run_date)
    );
  end if;

  v_prev_next := v_template.next_run_date;

  v_draft := insert_journal_entry_draft(
    v_template.company_id,
    v_period.id,
    v_template.next_run_date,
    'recurring'::journal_entry_type,
    v_template.narration_template,
    v_template.created_by,
    v_lines_json,
    null,
    v_template.id,
    '[]'::jsonb
  );

  v_new_next := advance_recurring_next_run_date(
    v_template.next_run_date,
    v_template.frequency,
    v_template.day_of_month
  );
  v_still_active := v_template.end_date is null or v_new_next <= v_template.end_date;

  update recurring_journal_templates
     set next_run_date = v_new_next,
         is_active = v_still_active,
         updated_at = now()
   where id = v_template.id
  returning * into v_template;

  return jsonb_build_object(
    'skipped', false,
    'template_id', v_template.id,
    'template_name', v_template.template_name,
    'auto_post', v_template.auto_post,
    'previous_next_run_date', to_jsonb(v_prev_next),
    'next_run_date', to_jsonb(v_template.next_run_date),
    'is_active', v_template.is_active,
    'entry', v_draft->'entry',
    'lines', v_draft->'lines',
    'attachments', v_draft->'attachments'
  );
end;
$$;

revoke all on function generate_due_recurring_entry(uuid, date) from public;
revoke all on function generate_due_recurring_entry(uuid, date) from authenticated;
revoke all on function generate_due_recurring_entry(uuid, date) from anon;
grant execute on function generate_due_recurring_entry(uuid, date) to service_role;

-- ============================================================================
-- 10. REVERSAL RPC — atomic reversal (draft -> lines -> post -> mark original)
-- ============================================================================

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

  v_entry_number := allocate_next_entry_number(v_original.company_id);

  insert into journal_entries (
    company_id, entry_number, period_id, entry_date, entry_type, status,
    narration, reference_number, reverses_entry_id, created_by
  ) values (
    v_original.company_id, v_entry_number, v_next_period.id, v_next_period.period_start,
    'reversal', 'draft', format('Reversal of journal entry %s', v_original.entry_number),
    v_original.reference_number, p_original_id, p_created_by
  )
  returning * into v_reversal;

  insert into journal_lines (journal_entry_id, line_number, account_id, debit, credit, description, cost_center)
  select v_reversal.id, jl.line_number, jl.account_id, jl.credit, jl.debit, jl.description, jl.cost_center
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

revoke all on function reverse_journal_entry(uuid, uuid, boolean) from public;
revoke all on function reverse_journal_entry(uuid, uuid, boolean) from authenticated;
revoke all on function reverse_journal_entry(uuid, uuid, boolean) from anon;
grant execute on function reverse_journal_entry(uuid, uuid, boolean) to service_role;

alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from authenticated;

-- ============================================================================
-- 11. COMPANY MEMBERSHIP & ROLES (minimal — scoped to Module 1.1.A needs only)
-- ============================================================================

create type company_role as enum (
  'owner',
  'accountant',
  'manager',
  'staff',
  'viewer',
  'external_accountant'
);

create table company_members (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         company_role not null,
  invited_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (company_id, user_id)
);

create index idx_company_members_company on company_members(company_id);
create index idx_company_members_user on company_members(user_id);

alter table company_members enable row level security;

create policy company_isolation_members on company_members
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);

-- [feature-spec.md decision #29] Membership-based RLS on `companies` itself.
-- Unlike every other company_isolation_* policy, this must NOT use
-- current_setting('app.current_company_id'): that variable is set AFTER the
-- caller already knows which company they are acting as. Listing/acting on
-- company rows is gated by actual company_members membership (auth.uid()).
--
-- is_company_member is SECURITY DEFINER so the exists-check can read
-- company_members without being blocked by company_isolation_members (which
-- still keys off app.current_company_id — a session variable that is unset
-- when the query under evaluation IS the companies table). Do not weaken
-- company_isolation_members; this helper is the scoped exception.
--
-- Lives in schema `private` (not PostgREST-exposed) so it cannot be called
-- via /rest/v1/rpc — Security Advisor lints 0028/0029. Authenticated still
-- needs EXECUTE for RLS policy evaluation on companies SELECT (#29).
-- anon does NOT get EXECUTE: anon has no SELECT grant on companies.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private.is_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from company_members
     where company_id = p_company_id
       and user_id = auth.uid()
  );
$$;

revoke all on function private.is_company_member(uuid) from public;
revoke all on function private.is_company_member(uuid) from anon;
grant execute on function private.is_company_member(uuid) to authenticated;
grant execute on function private.is_company_member(uuid) to service_role;

-- Drop the old PostgREST-exposed RPC if a prior schema apply created it in
-- `public` (Advisor lints 0028/0029). CREATE OR REPLACE cannot move a
-- function across schemas, so without this drop a fresh-looking re-apply
-- still leaves `public.is_company_member` callable at /rest/v1/rpc/.
drop function if exists public.is_company_member(uuid);

alter table companies enable row level security;

drop policy if exists company_isolation_companies on companies;
create policy company_isolation_companies on companies
  using (private.is_company_member(id));

-- ============================================================================
-- 12. DATA API GRANTS (service_role / sb_secret_*)
-- ============================================================================
-- [feature-spec.md decision #23] Backend-mediated access only (§5.1).
-- New Supabase projects no longer auto-GRANT public-schema tables to
-- service_role — without this block, PostgREST returns 42501 permission
-- denied for table * on a fresh project, even though every earlier grant
-- checklist in this file (§5.1/§9b/§10) covers FUNCTION execute grants
-- only, not base TABLE access. This was discovered via the fresh-DB drift
-- verification exercise (feature-spec.md §8 decision index) — exactly the
-- kind of environment-default assumption that check exists to catch.
-- One-shot re-apply on a live project that missed this block: run §12 in the
-- SQL Editor (no duplicate standalone grants file — see feature-spec.md §5.5).

grant usage on schema public to service_role;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select on public.v_trial_balance to service_role;
grant select on public.vat_invoice_register to service_role;

-- [feature-spec.md decision #29] SELECT-only for authenticated on companies
-- so membership RLS is enforceable (and testable) when a user JWT hits the
-- Data API. Writes stay service_role-only. anon remains ungated - no grant.
-- All other tables remain service_role-only per section 5.1 / decision #10.
grant select on public.companies to authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;

-- ============================================================================
-- END OF SCHEMA - Module 1.1.A complete (all 14 features, Phase A/B/C).
-- Next schema-affecting work belongs to a later module, not this file:
--   - journal_approvals (multi-approver audit trail, if ever needed beyond
--     the current single-Owner-approval model)
--   - year_end_closing_runs (if a dedicated run-tracking table is ever
--     needed beyond the audit_log + journal_entries.entry_type record)
--   - FTA-specific compliance tables (VAT 201 snapshots, CT computations) -
--     out of scope for Module 1.1.A, belongs to whichever module handles
--     VAT/CT filing
-- ============================================================================
