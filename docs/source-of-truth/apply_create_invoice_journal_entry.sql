-- Apply create_invoice_journal_entry + issue_invoice ledger wiring to live Supabase.
-- Prerequisite: apply_journal_entry_type_sales_invoice_credit_note.sql (enum values).
-- Source of truth: docs/source-of-truth/schema.sql (create_invoice_journal_entry, issue_invoice).

-- Run the full function bodies from schema.sql via your migration pipeline, or paste
-- the create_invoice_journal_entry and issue_invoice definitions from schema.sql here.
-- This stub documents the migration order; CI/deploy should apply schema.sql sections.

-- Migration note (2026-08-31):
-- 1. journal_entry_type must include 'sales_invoice' (additive enum migration).
-- 2. create_invoice_journal_entry(p_invoice_id, p_created_by, p_reference_number) — new RPC.
-- 3. issue_invoice now calls create_invoice_journal_entry in the same transaction and sets
--    invoices.journal_entry_id on Issue.
-- 4. No CHECK constraint or trigger enumerates journal_entry_type — enum extension is safe.
-- 5. Rollback: restore prior issue_invoice (without journal call); posted entries remain in ledger.
