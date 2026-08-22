-- ============================================================================
-- inFINity — Double-Entry Accounting Engine
-- Core Ledger Schema (PostgreSQL / Supabase)
-- ============================================================================
-- Design notes:
--   • Multi-tenant via company_id + Row-Level Security (RLS) — one bug in the
--     app layer cannot leak one company's ledger into another's.
--   • Immutability is enforced at the DATABASE layer via triggers, not just
--     app logic — no DELETE is ever permitted on posted financial records.
--   • Debit/credit imbalance rejection is enforced via trigger BEFORE a
--     journal entry can transition to 'posted', not just on insert.
--   • This schema covers Phase A (ledger + posting engine) and Phase B
--     (manual entry, reversals, opening balances) fully, and lays the table
--     structure for Phase C (approvals, recurring, period close, year-end)
--     — the business RULES for Phase C (thresholds, close policy, etc.) will
--     be wired in once you send them; the tables below are rule-agnostic.
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

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

create type audit_action as enum ('insert', 'update', 'reversal', 'status_change');

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

-- Enforce hierarchy depth <= 4 and auto-compute depth from parent
create or replace function enforce_account_hierarchy_depth()
returns trigger as $$
declare
  parent_depth smallint;
begin
  if new.parent_account_id is null then
    new.depth := 1;
  else
    select depth into parent_depth from accounts where id = new.parent_account_id;
    if parent_depth is null then
      raise exception 'Parent account % not found', new.parent_account_id;
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

create index idx_periods_company on accounting_periods(company_id);

-- ============================================================================
-- 4. JOURNAL ENTRIES + LINES  (the core double-entry ledger)
-- ============================================================================

create table journal_entries (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  entry_number          bigint not null,             -- sequential, human-facing, per company
  period_id             uuid not null references accounting_periods(id),

  entry_date            date not null,
  entry_type            journal_entry_type not null default 'manual',
  status                journal_entry_status not null default 'draft',

  narration             text not null,
  reference_number      text,

  -- Reversal linkage
  reverses_entry_id      uuid references journal_entries(id),
  reversed_by_entry_id   uuid references journal_entries(id),

  -- Recurring linkage
  recurring_template_id  uuid,                        -- FK added after recurring_journal_templates exists

  -- Approval linkage
  requires_approval      boolean not null default false,
  approved_by             uuid,
  approved_at              timestamptz,
  rejected_by              uuid,
  rejected_at              timestamptz,
  rejection_reason         text,

  created_by             uuid not null,
  posted_at               timestamptz,

  created_at              timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

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
create or replace function enforce_journal_balance_on_post()
returns trigger as $$
declare
  total_debit  numeric(18,2);
  total_credit numeric(18,2);
begin
  if new.status = 'posted' and (old.status is distinct from 'posted') then
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
  return new;
end;
$$ language plpgsql
   set search_path = public, pg_temp;

create trigger trg_enforce_journal_balance_on_post
  before update on journal_entries
  for each row execute function enforce_journal_balance_on_post();

-- Immutability: once posted, an entry's lines cannot be edited or deleted,
-- and the entry itself cannot be deleted — only reversed via a new entry.
create or replace function prevent_posted_line_mutation()
returns trigger as $$
declare
  entry_status journal_entry_status;
begin
  select status into entry_status from journal_entries
    where id = coalesce(new.journal_entry_id, old.journal_entry_id);
  if entry_status = 'posted' then
    raise exception 'Cannot modify lines of a posted journal entry — reverse it instead';
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql
   set search_path = public, pg_temp;

create trigger trg_prevent_posted_line_update
  before update or delete on journal_lines
  for each row execute function prevent_posted_line_mutation();

create or replace function prevent_posted_entry_deletion()
returns trigger as $$
begin
  if old.status = 'posted' then
    raise exception 'Posted journal entries cannot be deleted — use a reversing entry (entry_type = reversal)';
  end if;
  return old;
end;
$$ language plpgsql
   set search_path = public, pg_temp;

create trigger trg_prevent_posted_entry_deletion
  before delete on journal_entries
  for each row execute function prevent_posted_entry_deletion();

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
create or replace function log_journal_entry_change()
returns trigger as $$
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
    insert into audit_log (company_id, table_name, record_id, action, actor_id, old_data, new_data)
      values (new.company_id, 'journal_entries', new.id,
        (case when new.status = 'reversed' then 'reversal' else 'status_change' end)::audit_action,
        coalesce(new.approved_by, new.created_by), to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end;
$$ language plpgsql
   set search_path = public, pg_temp;

create trigger trg_log_journal_entry_change
  after insert or update on journal_entries
  for each row execute function log_journal_entry_change();

-- ============================================================================
-- 8. ROW-LEVEL SECURITY (multi-tenant isolation)
-- ============================================================================
-- Assumes the app sets `request.jwt.claims.company_id` (Supabase convention)
-- or an equivalent session variable per authenticated request.

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

create view v_trial_balance as
select
  a.company_id,
  a.id as account_id,
  a.account_number,
  a.account_name,
  a.category,
  a.normal_balance,
  coalesce(sum(jl.debit), 0)  as total_debit,
  coalesce(sum(jl.credit), 0) as total_credit,
  case a.normal_balance
    when 'debit'  then coalesce(sum(jl.debit), 0) - coalesce(sum(jl.credit), 0)
    when 'credit' then coalesce(sum(jl.credit), 0) - coalesce(sum(jl.debit), 0)
  end as balance
from accounts a
left join journal_lines jl on jl.account_id = a.id
left join journal_entries je on je.id = jl.journal_entry_id and je.status = 'posted'
group by a.company_id, a.id, a.account_number, a.account_name, a.category, a.normal_balance;

-- ============================================================================
-- END OF SCHEMA — Phase A/B complete.
-- Phase C tables to layer in once accounting rules are received:
--   • journal_approvals (approval audit trail, if multi-approver in future)
--   • year_end_closing_runs (tracks each closing run + which entries it generated)
--   • Any FTA-specific compliance tables (VAT 201 snapshots, CT computations)
-- ============================================================================