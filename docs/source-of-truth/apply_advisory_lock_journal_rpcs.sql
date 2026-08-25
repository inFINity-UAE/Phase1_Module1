-- apply_advisory_lock_journal_rpcs.sql
-- Apply this entire file once in the Supabase SQL editor (in order).
-- Then re-check grants (queries at bottom).
--
-- Order matters:
--   1. allocate_next_entry_number
--   2. insert_journal_entry_draft / create_opening_balance_entry /
--      create_year_end_closing_entry (depend on #1)
--   3. reverse_journal_entry (CREATE OR REPLACE — uses #1)
--
-- Does NOT alter any table/column/constraint definitions.

\ir allocate_next_entry_number.sql
\ir insert_journal_entry_draft.sql
\ir create_opening_balance_entry.sql
\ir create_year_end_closing_entry.sql
\ir reverse_journal_entry.sql

-- Grant verification (run after apply if \ir is unsupported — paste each
-- file's body manually in order, then run):
--
-- select routine_name, grantee, privilege_type
--   from information_schema.role_routine_grants
--  where routine_schema = 'public'
--    and routine_name in (
--      'allocate_next_entry_number',
--      'insert_journal_entry_draft',
--      'create_opening_balance_entry',
--      'create_year_end_closing_entry',
--      'reverse_journal_entry'
--    )
--  order by routine_name, grantee;
--
-- Expected: service_role = EXECUTE only; no anon / authenticated / public.
