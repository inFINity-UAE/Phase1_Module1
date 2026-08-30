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

create type journal_entry_type as enum (
  'manual',
  'recurring',
  'reversal',
  'opening_balance',
  'year_end_closing',
  'system'
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
create table company_settings (
  company_id                    uuid primary key references companies(id) on delete cascade,
  journal_approval_threshold    numeric(18,2),        -- entries above this need Owner approval; null = disabled
  approval_threshold_currency   char(3) not null default 'AED',
  default_period_length         text not null default 'monthly', -- monthly | quarterly
  allow_period_reopen           boolean not null default true,
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
-- Pagination: deferred (same as GET /accounts and GET /journal-entries).
-- SECURITY INVOKER + §5.1 grants.
create or replace function get_general_ledger(
  p_company_id uuid,
  p_account_id uuid default null,
  p_date_from date default null,
  p_date_to date default null
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
  running_balance numeric(18,2)
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
  )
  select
    wr.journal_line_id,
    wr.journal_entry_id,
    wr.entry_number,
    wr.entry_date,
    wr.narration,
    wr.entry_status,
    wr.account_id,
    wr.account_number,
    wr.account_name,
    wr.normal_balance,
    wr.line_number,
    wr.debit,
    wr.credit,
    wr.line_balance,
    wr.running_balance
  from with_running wr
  where (p_date_from is null or wr.entry_date >= p_date_from)
    and (p_date_to is null or wr.entry_date <= p_date_to)
  order by wr.account_number, wr.entry_date, wr.entry_number, wr.line_number;
end;
$$;

revoke all on function get_general_ledger(uuid, uuid, date, date) from public;
revoke all on function get_general_ledger(uuid, uuid, date, date) from authenticated;
revoke all on function get_general_ledger(uuid, uuid, date, date) from anon;
grant execute on function get_general_ledger(uuid, uuid, date, date) to service_role;

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
-- RETAINED_EARNINGS_NOT_FOUND, NO_PL_BALANCES_TO_CLOSE
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

revoke all on function create_year_end_closing_entry(uuid, integer, uuid, date, text) from public;
revoke all on function create_year_end_closing_entry(uuid, integer, uuid, date, text) from authenticated;
revoke all on function create_year_end_closing_entry(uuid, integer, uuid, date, text) from anon;
grant execute on function create_year_end_closing_entry(uuid, integer, uuid, date, text) to service_role;

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
