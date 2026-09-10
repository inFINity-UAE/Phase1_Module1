---
name: accounting-audit
description: Audit the double-entry engine — posting, balance, periods, reversals, COA, isolation, constraints, tests. Use when the user says "Audit the accounting engine" or "ledger audit".
---

# Accounting engine audit

Never invent accounting policy. Authority: PDF → `schema.sql` → owning feature spec → code/tests. Conflicts: report, do not resolve by preference.

Read `.cursor/checklists/accounting-invariants.md` and `.cursor/references/project-map.md`.

## Inspect (search, then read)

| Area | Where |
|---|---|
| JE create/post/balance | `insert_journal_entry_draft`, `trg_enforce_journal_balance_on_post`, `JournalEntriesService.post` |
| Account validation | `assertAccountsUsableForCompany`, `enforce_account_number_category`, opening-balance category |
| Immutability / reverse | posted-line/header/delete triggers, `reverse_journal_entry`, §4.2 |
| Periods | exclusion constraint, soft-close only, half-open dates, Nest period helpers |
| OB / YE | RPCs, `ob:`/`ye:` locks, 3100, `is_ledger_truth_status` |
| Approvals | Owner bypass, Manager approve, D write-off threshold, ECL non-blocking |
| Document posting | `issue_invoice` / `void_invoice` / credit notes / payment / write-off / ECL RPCs |
| Reports | H1 + D RPCs all use ledger-truth |
| Audit log | trigger + `delete_blocked` separate request |
| Isolation | membership + `company_id` filters; RLS still present |
| Race | advisory locks, recurring `rjt:`, payment/ECL locks |
| Tests | post/reverse/YE/OB/balance/excel TC / integrity sweep / reports H1 |

## Classify each finding

- Accounting **rule** problem (policy vs spec)
- **Implementation** problem (spec vs Nest/SQL)
- **Database integrity** problem (missing constraint/trigger)
- **Security** problem
- **Testing** gap
- **Documentation** gap

## Output

`.cursor/templates/accounting-audit.md`. No finding without evidence.
