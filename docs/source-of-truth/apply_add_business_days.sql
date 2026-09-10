-- apply_add_business_days.sql
-- Apply in Supabase SQL editor on existing projects, then keep in sync with schema.sql.
--
-- [feature-spec-1_1_D.md §4.5a / D-10, D-13, D-14 / §3.1b]
-- is_business_day + add_business_days. Idempotent (CREATE OR REPLACE).

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

  -- §3.1b: company-scoped holiday for the date wins; else UAE-wide.
  -- D-14: PROVISIONAL and CONFIRMED both block.
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
