-- ============================================================================
-- Data API grants for Nest service_role / sb_secret_* access
-- ============================================================================
-- Required on NEW Supabase projects (post Data-API grant change): tables created
-- via raw SQL are NOT auto-granted to service_role / anon / authenticated.
-- Without these, PostgREST returns 42501 permission denied for table *.
--
-- [feature-spec.md section 5.1 / decision #10] Backend-mediated access only —
-- grant table/view privileges to service_role, NOT anon/authenticated.
-- RPC EXECUTE grants remain in schema.sql on each function.
--
-- Apply once in Supabase SQL Editor after schema.sql, before seeding COA / tests.

grant usage on schema public to service_role;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Explicit view grant (trial balance is not covered by ALL TABLES on some PG versions)
grant select on public.v_trial_balance to service_role;

-- Future objects created by this role in public
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
