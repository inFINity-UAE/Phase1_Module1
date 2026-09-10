-- apply_public_holidays.sql
-- Apply in Supabase SQL editor on existing projects, then keep in sync with schema.sql.
--
-- [feature-spec-1_1_D.md §3.1b / D-10, D-14]
-- Creates public_holidays + partial unique indexes + RLS. Idempotent.
-- Seed separately via seed_uae_public_holidays.sql.

create table if not exists public_holidays (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid references companies(id),
  holiday_date   date not null,
  description    text not null,
  status         text not null default 'PROVISIONAL',
  source         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint public_holidays_status_check check (
    status in ('PROVISIONAL', 'CONFIRMED')
  )
);

create unique index if not exists public_holidays_company_date_uq
  on public_holidays (company_id, holiday_date)
  where company_id is not null;

create unique index if not exists public_holidays_uae_date_uq
  on public_holidays (holiday_date)
  where company_id is null;

create index if not exists idx_public_holidays_company on public_holidays(company_id);
create index if not exists idx_public_holidays_date on public_holidays(holiday_date);

alter table public_holidays enable row level security;

drop policy if exists company_isolation_public_holidays on public_holidays;
create policy company_isolation_public_holidays on public_holidays
  using (
    company_id is null
    or company_id = (select current_setting('app.current_company_id', true))::uuid
  )
  with check (
    company_id = (select current_setting('app.current_company_id', true))::uuid
  );

grant select, insert, update, delete on public.public_holidays to service_role;
