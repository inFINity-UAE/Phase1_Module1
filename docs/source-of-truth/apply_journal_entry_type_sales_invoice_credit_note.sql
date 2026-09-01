-- apply_journal_entry_type_sales_invoice_credit_note.sql
-- Apply in Supabase SQL editor on existing projects, then keep in sync with schema.sql.
--
-- [feature-spec-1.1.C.md decision #13 / Batch 2 step 1]
-- Prerequisite for create_invoice_journal_entry and create_credit_note_journal_entry
-- (next prompts). Additive enum extension only — no table/column/trigger/RPC changes.
--
-- Pre-migration audit (schema.sql, 2026-09-01): no CHECK constraint or trigger
-- enumerates journal_entry_type exhaustively. Existing references are point
-- equality on specific values only:
--   create_opening_balance_entry  → entry_type = 'opening_balance'
--   create_year_end_closing_entry → entry_type = 'year_end_closing'
--   reverse_journal_entry         → entry_type = 'reversal' guard
--   generate_due_recurring_entry  → 'recurring'::journal_entry_type literal
-- None require updating when adding sales_invoice / credit_note.
--
-- Rollback: Postgres cannot DROP enum values; rollback would require type rebuild
-- (only safe before any row uses the new values — true at migration time).

alter type journal_entry_type add value if not exists 'sales_invoice';
alter type journal_entry_type add value if not exists 'credit_note';
