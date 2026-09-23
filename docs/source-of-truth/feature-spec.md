# Module 1.1.A — Double-Entry Accounting Engine
## Feature Specification (Source of Truth)

Part of Module 1.1 · AI-Based Accounting Foundation, inFINity Phase 1 (MVP).
This is the authoritative feature list for Module 1.1.A only — do not infer
scope from Module 1.1.B–H or later phases.

**How to use this document:** Sections 1–7 state the current, effective
rules — read these as the standing spec, not a history. Section 8 is a
chronological decision index for traceability; every rule above is sourced
from a numbered, dated decision there. When a rule changed after it was
first logged, the section below states the *current* rule only — the
superseded version and why it changed are preserved in Section 8, not
repeated inline.

### Known open items

| Gap | Status | Detail |
|---|---|---|
| Hard-close / reopen HTTP; close checklist (Rules §1.22) | **Stub** | Schema columns reserved; not gaps |

All §7.16 / §7.26 audit findings are closed (#41–#48, #51–#54). Auth: **83/83** routes guarded across 15 controllers (#41, #53, #56 + H1 reports + Module 1.1.C customers/quotations/invoices/credit-notes). `--runInBand` is **not** required (#37). System-account UPDATE DB backstop closed (#58). Integrity sweep #59 closed its scope; hard-close/reopen remains the only stub. `v_trial_balance` status-filter live bug closed (#60). Year-end P&L aggregation uses `is_ledger_truth_status` (#61); Nest fiscal-year P&L read aligned via `get_profit_and_loss` RPC (#64). Recurring templates: unattended daily Nest `@Cron` (#62); concurrent due-generation race closed via `rjt:` advisory-lock RPC (#63). Module 1.1.C: customers (#C1-1) + quotations (#C1-2) + invoices (#C1-3) + credit notes (#C1-4) + quotation convert (#C1-5) landed.

**Fresh DB setup:** run `schema.sql` top-to-bottom (includes §12 table grants — no separate apply scripts).

---

## 1. Account Numbering Scheme (AUTHORITATIVE — supersedes any other document)

4-digit account numbering, 5 bands:

| Prefix | Category    | `schema.sql` `account_category` enum value |
|--------|-------------|---------------------------------------------|
| 1000s  | Assets      | `asset`                                      |
| 2000s  | Liabilities | `liability`                                  |
| 3000s  | Equity      | `equity`                                     |
| 4000s  | Income      | `income`                                     |
| 5000s  | Expenses    | `expense`                                    |

There is no separate leading-digit band for COGS. Cost of Goods Sold
accounts are `category = 'expense'`, numbered in the 5000s, distinguished
only by `sub_category` (e.g. `sub_category = 'COGS'`). This is a 5-band
scheme, not 6.

`normal_balance` values are the exact enum literals `debit` / `credit`
(lowercase), per `schema.sql`'s `normal_balance_type` enum — no other
casing or synonyms. *(Decision #5)*

---

## 2. Chart of Accounts

**Source of truth:** `Chart_of_Accounts_-_inFINity.xlsx`, finalized
2026-08-24 — 179 accounts, 136 default-active, correct 5-band scheme.
*(Decisions #12–16, superseding the placeholder version described in
`cursor-build-prompts.md`'s original Stage 1.)*

### 2.1 Column mapping (source file → `accounts` table)

| Source column | Maps to | Notes |
|---|---|---|
| Code | `account_number` | as-is, char(4) |
| Account Name | `account_name` | as-is |
| Band (e.g. "1000s - Assets") | `category` | derived enum value |
| Sub-Category | `sub_category` | as-is |
| Normal Balance | `normal_balance` | `"Dr"` → `'debit'`, `"Cr"` → `'credit'` |
| Default Active | `is_active` | `"Y"` → `true`, `"N"` → `false` |
| Account Nature + VAT/Tax Mapping + Notes | `description` | folded into a structured prefix: `"[Account Nature][VAT Mapping] Notes"`, omitting brackets for blank source fields |
| UAE-Specific | *(not stored)* | source-file annotation only |

The `accounts` table has no dedicated columns for `Account Nature` or
`VAT / Tax Mapping` — adding columns would be a schema change, out of
scope for seed-data work. VAT-return logic that would actually *consume*
the VAT Mapping value operationally (e.g. auto-populating a VAT 201
return) belongs to whichever later module handles VAT filing, not
Module 1.1.A. *(Decision #14)*

### 2.2 Special account treatments

- **Zakat:** `2350 Zakat Payable` (`liability`, default/`is_active = true`)
  is the default. `3300 Zakat Reserve` (`equity`, `is_active = false`) is
  an opt-in account for AAOIFI-style Islamic-FI presentation, added via
  the standard custom-account creation feature — no special-case engine
  logic needed for both treatments. *(Decisions #8, #12)*
- **Import Duty** is two related accounts: `2800 Import Duty Payable`
  (`liability`, `sub_category = 'Other Liabilities'` — the accrued amount
  owed to customs, an ordinary payable) and `5030 Import Duty & Customs
  Clearance` (`expense`, `sub_category = 'COGS'` — the recognized cost).
  **Flag for revisit:** once Module 2.2 (Inventory) exists, Rules §1.9
  requires `5030`'s cost to be capitalized into inventory instead of
  expensed directly — leave a code comment, don't build inventory-costing
  logic now. *(Decisions #7, #13)*
- **`3100 Retained Earnings`** is seeded with `is_system_account = true`
  — it is the year-end closing target (Rules §4.11), and
  `prevent_account_deletion()` blocks hard deletion of any
  `is_system_account = true` row regardless of transaction history.
  *(Decision #16)*

### 2.3 Hierarchy demonstration accounts

Net-new accounts, not sourced from the Rules PDF or feature list, added
solely to prove the `parent_account_id`/depth mechanism works (per the
"create a few real 2–3 level examples" requirement). These use 4-digit
codes the finalized COA leaves unused within their band:

- `1021 Bank Account - Current (AED) - Operations` (parent `1020`, depth 2)
- `1022 Bank Account - Current (AED) - Payroll Disbursement` (parent `1020`, depth 2)
- `5101 Salaries & Wages Expense - Head Office` (parent `5100`, depth 2)
- `5102 Salaries & Wages Expense - Head Office - Management` (parent `5101`, depth 3)

*(Decision #15)*

### 2.4 Demo company

The **current** fixed demo company is:

```
00000000-0000-0000-0000-000000000002 — "Demo Company (Finalized COA Seed)"
```

This is the one and only stable, non-rotating company in the project — used
as a **read-only COA clone source** for minting fresh test companies, never
destructively reset itself. Dev/test scaffolding only; production company
onboarding remains a separate, not-yet-built feature. *(Decision #6)*

The original demo company, `00000000-0000-0000-0000-000000000001`, is
**retired** — it accumulated posted transaction history from testing
against the old placeholder COA, and the schema's own immutability
guarantees correctly refuse to let it be reseeded (posted `journal_lines`
can never be deleted). It is left untouched, unused by any current seed
script, fixture, or setup. *(Decision #17 — see §6 for why this couldn't
just be wiped, and §7 for the broader pattern this established.)*

---

## 3. Features

- Complete general ledger with double-entry debit/credit posting and
  imbalance rejection
- UAE-standard pre-built chart of accounts — Assets, Liabilities, Equity,
  Income, Expenses (see §2)
- 179 default accounts (136 default-active) including UAE-specific:
  VAT Payable, VAT Receivable, Corporate Tax Provision, Import Duty,
  Zakat, Free Zone Income
- Custom account creation with sub-account hierarchy up to 4 levels deep
- 4-digit account numbering per §1
- Account locking: accounts with transaction history deactivated, not
  deleted — protects historical accuracy
- Manual journal entry with narration, reference number, and document
  attachment
- Recurring journal entries: depreciation, prepaid amortisation, accruals
  — set frequency and auto-post. Generation is **manually triggerable**
  (`POST …/run-due`, `POST …/generate`) **and** **unattended-scheduled**
  (Nest `@Cron` daily walk of due `next_run_date` across companies —
  decision #62). Concurrent cron + manual (or overlapping manual) calls
  for the **same** template due date produce **exactly one** journal
  entry: `generate_due_recurring_entry` claims `next_run_date` under a
  per-template `rjt:` advisory lock (#63 / #20). `auto_post` still only
  controls whether a generated entry attempts `JournalEntriesService.post()`
  (#52); it is not a bypass of approval/soft-close rules.
- Journal approval workflow: Owner must approve entries above a
  configurable AED threshold
- Period soft-close with override permission for corrections by authorised
  users
- Year-end closing: auto-transfer of P&L balances to retained earnings
  account
- Reversing journal entries: one-click reversal in the next period
- Opening balance entry: historical import for companies setting up
  mid-year
- Immutable audit trail: successful mutations logged (insert / status_change /
  reversal); blocked hard-delete attempts on posted entries and lines also
  logged (`audit_action = delete_blocked`) — reversals only, no deletions ever
  *(Decision #56)*

---

## 4. Journal Entry & Period Lifecycle Rules

These are hard rules resolving gaps not covered by the Accounting Rules
PDF — treat as settled, not open questions.

### 4.1 Approval workflow

**Owner role bypasses the approval workflow entirely**, regardless of
entry amount or who created the entry — including approving/posting their
own entries. The Owner is the ultimate accountable party. The
`pending_approval → approve` flow applies only when the original poster
is NOT an Owner. *(Decision #1)*

**Self-approval audit label (#55):** when a journal entry transitions into
`approved` or `posted` with `approved_by = created_by`, `log_journal_entry_change`
writes `audit_log.notes = 'Self-approved by Owner'` on that `status_change`
row. Owner approving a different creator's entry leaves `notes` null.
Detection is equality of the two actor columns only — no `company_role`
lookup in SQL (Nest §4.1 already gates who may approve). Owner posting
their own draft (bypass path) stamps `approved_by` so the same label
applies. *(Decision #55)*

**Recurring templates:** `auto_post=true` controls whether generation
may automatically *attempt* posting; it does **not** bypass approval
thresholds, soft-close authorization, or any other §4.1 posting rule.
Recurring auto-post uses the same `JournalEntriesService.post()` path as
manual entries. *(Decision #52)* Unattended due-template discovery is
`RecurringJournalSchedulerService` (daily `@Cron`); manual HTTP
run-due/generate remain available. *(Decision #62)* Both paths call
`generate_due_recurring_entry` so a due cycle cannot double-generate
under concurrent load. *(Decision #63)*

### 4.2 Reversals

- **An entry cannot be reversed twice.** Once reversed, a journal entry's
  status becomes `reversed` and is locked from being reversed again — a
  second reversal would double-count the correction and unbalance the
  ledger. *(Decision #2)*
- **A reversal entry cannot itself be reversed** — there is no
  "undo the undo" path through the standard reversal mechanism. If a
  reversal itself needs correcting, that requires a manual adjusting
  entry. Enforced by checking `entry_type = 'reversal'`. *(Decision #9)*

### 4.3 Opening balances

**One-time per company per fiscal year**, not additive/repeatable. A
second `opening_balance` entry for the same company + fiscal year is
rejected; corrections go through a manual adjusting/reversing entry
instead. *(Decision #3; RPC enforcement in §6)*

**Account categories:** lines may only reference `asset`, `liability`, or
`equity` accounts — never `income` or `expense` (would corrupt
current-year P&L). Rejected at the Nest opening-balance call site and
atomically in `create_opening_balance_entry` before any inserts
(`OPENING_BALANCE_INVALID_ACCOUNT_CATEGORY`). The shared
`assertAccountsUsableForCompany` helper (§4.8) is not category-aware;
opening-balance uses `assertOpeningBalanceAccountsUsable` instead. *(Decision #57)*

### 4.4 Year-end closing

**One-time per company per fiscal year.** It posts real entries
transferring P&L into Retained Earnings — running it twice would
double-transfer. A second `year_end_closing` entry for the same
company + fiscal year is rejected outright, with no partial cleanup
attempted. *(Decision #4; RPC enforcement in §6)*

P&L balances closed into account **3100** are aggregated from
`journal_lines` whose parent passes **`is_ledger_truth_status`**
(`posted` ∪ `reversed`) and belong to periods of that fiscal year —
same predicate as H1 reporting / `v_trial_balance` (#60 / #61). Signed
balances use `account_signed_balance` (lockstep with
`get_profit_and_loss`). Nest fiscal-year P&L verification reads
(`getProfitAndLossBalancesForFiscalYear`) delegate to that same RPC for
the fiscal year's date bounds — no independent Nest status filter
(#64).

### 4.5 Period create / list / update (#30)

`accounting_periods` columns, per `schema.sql`: `company_id`,
`period_start`, `period_end`, `fiscal_year`, `status` (`open` /
`soft_closed` / `closed`, default `open`), plus soft-close/close/reopen
actor+timestamp columns and `reopen_reason` — there is no period
label/number column.

- **Create:** accepts `company_id`, `period_start`, `period_end`,
  `fiscal_year` only; `status` is never client-settable, always the DB
  default (`open`). Rejects overlapping date ranges for the same company.
- **List:** requires `company_id` as a query param (matching the existing
  accounts/journals list precedent — `AuthenticatedUser` carries no
  implicit single company), returned in chronological order.
- **Update:** editable fields are `period_start`, `period_end`,
  `fiscal_year` only — `status` and `company_id` are rejected by DTO
  whitelisting. Soft-close (§5.3) remains the **only** path for status
  transitions; this endpoint can never open/close a period. Blocked
  entirely if the period's status is not `open`, or if any `posted`
  journal entry already references it.
- **Hard-close, reopen, and the close-checklist feature remain out of
  scope** — schema-reserved, unwired, unchanged by this decision.

**Enforcement:** overlap rejection (service + DB exclusion constraint #38);
posted-activity edit block (service); soft-close is the only status-transition
path. Hard-close, reopen, close checklist: out of scope. *(Decision #30)*

### 4.6 Journal entry list + draft header update (#31)

`journal_entries` columns, per `schema.sql`: `company_id`,
`entry_number`, `period_id`, `entry_date`, `entry_type`, `status`
(`draft` | `pending_approval` | `approved` | `rejected` | `posted` |
`reversed`, default `draft`), `narration`, `reference_number`, reversal
and recurring linkage, approval actor/timestamp columns, `created_by`,
`posted_at`, `created_at`, `updated_at`.

DB immutability today: `trg_prevent_posted_line_update` (lines only),
`trg_prevent_posted_entry_deletion` (DELETE of posted headers), and
`trg_enforce_journal_balance_on_post`. **There is no trigger blocking
UPDATE of a posted (or otherwise non-draft) journal entry header.**

- **List (`GET /journal-entries`):** requires `company_id` query param
  (same pattern as accounting-periods, §4.5/#30). Optional filters:
  `status`, `period_id`. Ordered `entry_date` DESC, then `entry_number`
  DESC (most recent first). Matches existing `:id` / attachments GET
  conventions (path params only; no pagination invented).
- **Header update (`PATCH /journal-entries/:id`):** editable fields are
  `narration`, `reference_number`, `entry_date`, `attachments` only.
  `entry_date` must fall within the entry's linked period (#54).
  `status`, `company_id`, `period_id`, lines, and all identity/actor
  fields are rejected by DTO whitelisting. Allowed only while
  `status = 'draft'`.
- **Out of scope:** line mutations via this endpoint.

**Enforcement:** draft-only editability enforced in service + optimistic
`.eq('status','draft')` filter; DB backstop `trg_prevent_nondraft_header_mutation`
(#38). *(Decision #31)*

### 4.7 Journal line routes (#32, #34, #56)

- **POST /journal-lines:** body journal_entry_id + line fields (CreateJournalLineDto).
  Draft entries may be unbalanced until post; posted-parent line add blocked by
  trg_prevent_posted_line_update (#28) → 400.
- **PATCH /journal-lines/:id:** purpose-built UpdateJournalLineDto (#50).
- **DELETE /journal-lines/:id:** wired to existing deleteLine (#34); posted
  parent blocked by #28 → 400 + `audit_log` row with `delete_blocked` (#56).
- **DELETE /journal-entries/:id:** hard-delete drafts (cascade); posted → 400
  + `delete_blocked` audit (#56). Actor from session.
- **Auth:** session + membership guards (#27, #41).

### 4.8 ccount_id same-company + active checks (#35, #39, #44)

Shared helper ssertAccountsUsableForCompany rejects **400** when the account
is missing, belongs to another company, or is_active = false. Applied on every
client-supplied ccount_id write path:

| Path | Module |
|---|---|
| createLine, updateLine (when ccount_id changes), insert_journal_entry_draft | Journal lines / entries |
| `create_opening_balance_entry` RPC | Opening balance (same-company + active + balance-sheet category #57) |
| Recurring template insert, insertLine, updateLine | Recurring templates (#44) |

Year-end and reversal lines use system-resolved accounts — not validated here.

### 4.9 Accounts update — PATCH /accounts/:id (#36, #54, #58)

| Column(s) | Editable? |
|---|---|
| account_name, sub_category, description | Yes |
| account_number, category, normal_balance, parent_account_id, depth, is_system_account, company_id, is_active | No — structural/identity; deactivate uses dedicated route |

Purpose-built UpdateAccountDto (not PartialType(CreateAccountDto)).
System accounts: Nest blocks **all** PATCH and deactivate (#36/#54);
DELETE blocked at DB by `trg_prevent_account_deletion`. **DB backstop for
structural UPDATE** — `trg_prevent_system_account_mutation` (#58) rejects
changes to the structural/identity columns above when
`is_system_account = true` (metadata columns remain writable at DB;
mirrors `prevent_nondraft_header_mutation`'s NEW-vs-OLD shape).

### 4.10 DB defense-in-depth — period overlap + posted-header immutability (#38)

Service-layer checks from §4.5/§4.6 retained; DB backstops added:

- **ccounting_periods_company_daterange_excl** — tree_gist exclusion on
  overlapping (period_start, period_end) per company_id → 23P01.
- **	rg_prevent_nondraft_header_mutation** — blocks header edits
  (
arration, 
eference_number, entry_date, attachments) when
  status != 'draft'; status-machine transitions unaffected.

Both in schema.sql; re-apply from there on older DBs.

### 4.11 Account creation — system fields (#42)

CreateAccountDto rejects is_system_account, locked_at, locked_reason
(DTO whitelist + repository hardcodes is_system_account = false on insert).

### 4.12 Recurring template update (#43)

Purpose-built UpdateRecurringJournalTemplateDto — editable:
	emplate_name, 
arration_template, requency, dates, day_of_month,
uto_post, is_active. Rejects company_id, created_by, lines, id,
timestamps. Repository never writes company_id.

### 4.13 Recurring template line ccount_id (#44)

Same ssertAccountsUsableForCompany as §4.8 on template line insert/update paths.

### 4.14 parent_account_id same-company (#45)

DB trigger enforce_account_hierarchy_depth rejects parent from another
company_id before depth check (schema.sql §2).

### 4.15 Balance-on-post trigger INSERT backstop (#46)

	rg_enforce_journal_balance_on_post is BEFORE INSERT OR UPDATE:
- INSERT with status = 'posted' rejected unconditionally (use draft→lines→UPDATE).
- UPDATE branch unchanged. RPCs unchanged — backstop for direct SQL only.
- INSERT branch must not reference OLD (use nested if tg_op = 'INSERT').

### 4.16 Account trial balance route (#47)

GET /accounts/:id/trial-balance — single-account row from _trial_balance
(	otal_debit, 	otal_credit, alance). Membership from account param (#41).

### 4.17 Trigger helper EXECUTE grants (#48, #58)

All ten RETURNS trigger helpers have §5.1 revoke/grant blocks in schema.sql.
EXECUTE grants are hygiene only — triggers fire without them
(scripts/trigger-execute-empirical-test.mjs).

Functions: enforce_account_number_category, enforce_account_hierarchy_depth,
prevent_account_deletion, prevent_system_account_mutation (#58),
enforce_journal_balance_on_post, prevent_posted_line_mutation,
prevent_posted_entry_deletion, prevent_nondraft_header_mutation,
block_audit_log_mutation, log_journal_entry_change.

### 4.18 Draft-create integrity (#51, #54)

App-layer helpers in journal-period.validation.ts, called from
insertJournalEntryDraftRpc and draft header PATCH:

| Check | When | Helper |
|---|---|---|
| period_id same-company | Draft create | ssertPeriodUsableForCompany (#51) |
| entry_date within period | Draft create + header PATCH | ssertEntryDateWithinPeriod |
| 
ecurring_template_id same-company | Draft create when set | ssertRecurringTemplateUsableForCompany |

Opening/year-end RPCs resolve period server-side; unchanged.

---

## 5. Security & Access Control

### 5.1 Backend-mediated access only

All data access is backend-mediated via Supabase `service_role` — no
table, view, or RPC in this schema is intended to be called directly by an
`authenticated`-role client. This is architectural, not a style
preference: every RLS policy isolates tenants via the session variable
`current_setting('app.current_company_id', true)`, which only a trusted
backend can safely set per-request. A client calling Supabase directly
with a user JWT has no safe way to set that variable — if it could, it
could impersonate any company.

**Grant checklist for every RPC/function, no exceptions:**
```sql
revoke all on function <fn> from public;
revoke all on function <fn> from authenticated;
revoke all on function <fn> from anon;
grant execute on function <fn> to service_role;
```
Supabase auto-grants `EXECUTE` to `anon`, `authenticated`, AND
`service_role` on every new function at creation — revoking from
`public`/`authenticated` alone is **not sufficient**; `anon` must be
revoked explicitly too (this was missed twice historically on
`reverse_journal_entry` before being caught). Hardened schema-wide via:
```sql
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from authenticated;
```
This reduces risk but doesn't guarantee someone won't explicitly re-grant
later — **every new or modified function must be verified individually**
against `information_schema.role_routine_grants` after creation/change,
not assumed from the default-privileges change alone. *(Decision #10)*

The NestJS backend must always derive the acting user's identity
(`created_by`, `approved_by`, `rejected_by`, and equivalents) from the
authenticated request's own session context — never from a client-supplied
field in the request body — since `service_role` bypasses RLS and the
backend is the only remaining safety net for tenant isolation.
*(Decision #10)*

**Membership enforcement (#41):** every tenant-scoped route has
`SupabaseAuthGuard` + `CompanyMembershipGuard` + `@RequireCompanyMembership`
(38 routes / 7 controllers). Non-members get 403. Actor identity always
from session — never from request body. See §5.11.

### 5.2 Roles — minimal, not full RBAC

`company_members` / `company_role` is intentionally minimal. Full
role-based permissions (custom roles, temporary access, per-feature
gating) is Module 1.6 (Platform, Settings & Security) and is explicitly
NOT built here. The `company_role` enum lists all six roles from the
phase-wise feature doc's Module 1.6.B (Owner / Accountant / Manager /
Staff / Viewer / External Accountant) so the table doesn't need
reshaping later, but Module 1.1.A only enforces two of them: **Owner**
bypasses approval (§4.1), and **Owner or Manager** may approve/reject a
pending entry. Every role check is resolved server-side from
`company_members` on every call — never trusted from a client-supplied
`actor_role`/`actor_id` field. *(Decision #11)*

### 5.3 DTO identity/role spoofing — audit outcome

A full audit confirmed every module was already correctly whitelisted
(global `whitelist: true` + `forbidNonWhitelisted: true` in `main.ts`
rejects undeclared body fields) **except one real gap**:
`AccountingPeriodsController` had no `SupabaseAuthGuard` on any route,
and its `soft-close` endpoint specifically trusted a client-supplied
`closed_by` with no session check at all — the same spoofing shape §5.1
exists to prevent, just never applied to this module.

**Fixed:** `@UseGuards(SupabaseAuthGuard)` at the controller level (all
routes, not per-route), `SoftCloseAccountingPeriodDto`'s `closed_by`
field removed, `closed_by` now derived from `@CurrentUser().id`. No
hard-close or reopen HTTP endpoints exist yet — `closed_by`/
`reopened_by`/`reopen_reason` columns are schema-reserved but unwired;
`reopened_by` is only ever written today via the already-authenticated
journal-posting override path. *(Decision #21)*

### 5.4 `v_trial_balance` regressions (security-invoker + status filter)

`v_trial_balance` was live-flagged by Supabase's linter as
`SECURITY DEFINER` — meaning its RLS checks ran as the view owner, not
the querying role, silently bypassing the `company_isolation_*` policies
that are this project's core multi-tenant guarantee. This had previously
been reported fixed, but the fix was never captured back into
`schema.sql` (or was lost) — a live example of exactly the kind of drift
§7's fresh-DB verification item exists to catch.

**Fixed (#22):** `with (security_invoker = true)` added to the view
definition in `schema.sql` §9; applied live via
`ALTER VIEW v_trial_balance SET (security_invoker = true);`. Treat this
clause as non-negotiable on any future edit of this view. *(Decision #22)*

**Status-filter bug (#60):** the view joined
`journal_entries` with `je.status = 'posted'` in the **LEFT JOIN ON**
clause. Under SQL semantics that does **not** drop `journal_lines` rows
when the status fails to match — `je` columns become null, but the line's
debit/credit still enter `sum()`. Live verification: unposted drafts
inflated balances; post+reverse netted to zero only by coincidental
cancellation (reversed original still summed). `GET /accounts/:id/trial-balance`
(#47) exposed this to real callers.

**Fixed (#60):** qualify lines in an inner subquery filtered by
`is_ledger_truth_status(status)` (`posted` ∪ `reversed`, same helper as
H1 reports — feature-spec-1_1_H.md #4), then LEFT JOIN that set to
`accounts` so empty / draft-only accounts still appear as 0/0/0.
`security_invoker = true` retained on `CREATE OR REPLACE VIEW`.
*(Decision #60)*

### 5.5 Fresh Supabase project: Data API grants are not automatic

Fresh Supabase projects do **not** auto-`GRANT` base table access
(`select`/`insert`/`update`/`delete`) to `service_role` on `public`-schema
tables. Every grant checklist elsewhere in this document (§5.1, §6) covers
**function** `EXECUTE` grants only — a separate, table-level grant block
is required or PostgREST returns `42501 permission denied` on a fresh
project even though `service_role` is otherwise the intended
all-access role. Discovered during fresh-DB drift verification (§7) —
exactly the class of environment-default assumption that check exists to
catch, and a genuinely new, permanent fact about Supabase project
defaults, not a one-off bug.

**Fixed:** `schema.sql` §12 grant block (table + sequence + default
privileges). Re-apply by running §12 on a live project that missed it —
no standalone grants file. *(Decision #23)*

### 5.6 Auth-guard coverage (#24) — closed

**Current state:** all 7 controllers / 38 routes — session + membership
(#41). Regression: `controller-auth-coverage.spec.ts` (401 + member probes,
38/38 — #53/#56). Originally #24 found unguarded read paths on accounts,
audit-log, journal list/detail, recurring routes.

### 5.7 `companies` RLS — closed (#29)

Originally no RLS on `companies` (#25). Fixed: `company_isolation_companies`
via `private.is_company_member` — see §5.10.

### 5.8 Journal-lines auth — closed (#27, #32, #34)

`JournalLinesController` was missed by #24; fixed with same guard pattern.
`POST /journal-lines`, `PATCH`, `DELETE` implemented (#32, #34).
Posted-parent line mutation blocked by #28 trigger.

### 5.9 Posted-line INSERT immutability (#28) — closed

`trg_prevent_posted_line_update` extended to `BEFORE INSERT OR UPDATE OR DELETE`
on `journal_lines` — blocks inserting lines onto posted parents. Test helpers
rewritten to draft→lines→post sequence.

**JWT clock-skew (#37):** parallel Jest runs hit intermittent `PGRST303` /
"JWT issued at future" with opaque `sb_secret_…` keys (gateway-minted JWTs).
Fixed via fetch-level retry on `SupabaseService` (5 attempts, `250ms * attempt`,
matches only `PGRST303`). `--runInBand` no longer required. Legacy `service_role`
JWT switch explicitly rejected (deprecation path).

### 5.10 `companies` RLS membership policy — closes §5.7 (#29)

Closes the gap §5.7 documented. Added `company_isolation_companies`,
membership-based via `company_members` / `auth.uid()` — deliberately
**not** `current_setting('app.current_company_id')`, since that variable
scopes an already-chosen company for a request and can't be used to
isolate the `companies` table itself (the query against `companies` is
what determines which company is in scope, so the same variable can't
also gate it without being circular).

**Policy DDL:**
```sql
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

alter table companies enable row level security;

create policy company_isolation_companies on companies
  using (private.is_company_member(id));

grant select on public.companies to authenticated;
```

`private.is_company_member()` is `SECURITY DEFINER` so the policy can read
`company_members` without circular RLS. **SELECT-only** grant to `authenticated`;
writes remain `service_role`-only (§5.1). Nest backend bypasses RLS — membership
enforcement is §5.11 (#41).

**Security Advisor (#40):** extensions in `extensions`; helper in `private` schema;
re-apply from `schema.sql` §9–§11 on older DBs.

**Test:** `companies.rls.integration.spec.ts` — anon `42501`; authenticated sees
member companies only.


### 5.11 Company membership guard (#41)

Every tenant-scoped route: `SupabaseAuthGuard` + `CompanyMembershipGuard` +
`@RequireCompanyMembership`. Resolves `company_id` from body, query, path
resource, or body ref — **403** if not a member. Attaches `request.user.role`
for post/approve/reject (no duplicate lookup).

API tightening: `GET /accounts` and `GET /recurring-journal-templates` require
`company_id`; `run-due` scoped to one company.

**38 routes / 7 controllers.** Tests: `company-membership.guard.integration.spec.ts`
+ `controller-auth-coverage.spec.ts` (38/38 — #53/#56). *(Decision #41)*

### 5.12 Blocked-delete audit completeness (#56)

Successful journal mutations are auto-logged by `trg_log_journal_entry_change`
(`insert` / `status_change` / `reversal`). Hard-deletes of **posted**
entries or lines are rejected by DB triggers and therefore never reach
those AFTER triggers — and any INSERT into `audit_log` inside the same
transaction as the RAISE would roll back with it.

**Rule:** every rejected hard-delete attempt is recorded as
`audit_action = delete_blocked` (enum value — not notes-only) by the Nest
service layer in a **separate** request after catching:

| Token | Trigger |
|---|---|
| `POSTED_ENTRY_DELETE_BLOCKED` | `trg_prevent_posted_entry_deletion` |
| `POSTED_LINE_DELETE_BLOCKED` | `trg_prevent_posted_line_update` (DELETE only) |

Audit row carries `actor_id` (session), `record_id` (targeted row),
`old_data` snapshot, and `notes` = the token. Caller still receives 400
with the human-readable immutability message. *(Decision #56)*

---

## 6. Concurrency — Advisory-Lock RPCs

Check-then-act patterns that had no atomicity guarantee under concurrent
load (entry-number allocation, opening-balance, year-end closing, and
recurring due generation) are fixed via `pg_advisory_xact_lock`-based
`SECURITY DEFINER` RPCs (grants follow §5.1's checklist exactly):

| RPC | Purpose |
|---|---|
| `allocate_next_entry_number(company_id)` | Company-scoped lock + `max(entry_number)+1`. Must be called inside the same transaction as the subsequent insert. |
| `insert_journal_entry_draft(...)` | Atomic draft insert (manual + recurring-generated entries) using the allocator above. |
| `create_opening_balance_entry(...)` | Full check→period-lookup→allocate→insert→post sequence, one transaction. |
| `create_year_end_closing_entry(...)` | Full check→P&L-line-build→allocate→insert→post sequence, one transaction. |
| `generate_due_recurring_entry(template_id, as_of_date)` | Full lock→re-read `next_run_date`→skip-if-claimed→draft insert→advance schedule sequence, one transaction. Cron (#62) and manual run-due/generate share this RPC. Nest still posts via `#52` after a successful claim. |
| `reverse_journal_entry(...)` | Existing reversal RPC, updated to call the shared allocator instead of its own inline `max+1`. |

**Lock key convention:**
- Entry-number allocation: `hashtext(company_id)` — global per company.
- Opening balance: `hashtext('ob:' || company_id || ':' || fiscal_year)`.
- Year-end closing: `hashtext('ye:' || company_id || ':' || fiscal_year)`.
- Recurring due generation: `hashtext('rjt:' || template_id)` — **per template**, not per company (two different templates for the same company may generate concurrently).
- `ob:`, `ye:`, and `rjt:` namespaces do **not** block each other — no rule
  requires opening-balance, year-end, and recurring operations to serialize
  against one another across those namespaces.
- **Lock order is always: namespace lock (`ob:`/`ye:`/`rjt:`) first, then the
  nested entry-number lock** — this ordering is fixed to avoid deadlocks
  between concurrent operations.

**Exception token contract** (NestJS maps these to clean HTTP errors):

| Token | Raised by |
|---|---|
| `OPENING_BALANCE_ALREADY_EXISTS` | opening-balance existence check |
| `OPENING_BALANCE_INVALID_ACCOUNT_CATEGORY` | opening-balance line uses income/expense account |
| `YEAR_END_ALREADY_CLOSED` | year-end existence check |
| `NO_OPEN_PERIOD_FOR_FISCAL_YEAR` | opening-balance's earliest-*open*-period lookup |
| `NO_PERIOD_FOR_FISCAL_YEAR` | year-end's latest-period lookup (any status — distinct from the token above) |
| `RETAINED_EARNINGS_NOT_FOUND` | year-end can't find account `3100` |
| `NO_PL_BALANCES_TO_CLOSE` | year-end finds nothing to close |
| `NO_NEXT_OPEN_PERIOD` | reversal can't find a next open period |
| `JOURNAL_DRAFT_REQUIRES_LINES` | any insert called with no lines |
| `POSTED_ENTRY_DELETE_BLOCKED` | `prevent_posted_entry_deletion` (Nest → `delete_blocked` audit #56) |
| `POSTED_LINE_DELETE_BLOCKED` | `prevent_posted_line_mutation` on DELETE (Nest → `delete_blocked` audit #56) |

Proven under actual concurrent load (dedicated concurrent test suite
firing simultaneous requests per company, confirming correct
serialization within a company and non-blocking behavior across
companies) plus 3x consecutive clean full-lifecycle regression runs.
*(Decision #20)*

---

## 7. Test Infrastructure — Company UUID Policy

**Core constraint:** a company row can never be deleted once any of its
`journal_entries` are posted — `prevent_posted_entry_deletion` fires
per-row even under `ON DELETE CASCADE` from `companies`. This is the
immutability guarantee working correctly, not a gap — **never route
around it** (no `TRUNCATE`, no disabling triggers, no force-delete).

**Standing policy:** every fixed-company integration/e2e suite generates
a **fresh, randomly-generated company UUID per test run**, clones the
finalized COA from `…0002` (§2.4) fresh into it, and never wipes or
reseeds an existing company. This is implemented as **one shared setup
helper**, not duplicated per suite. Old fixed IDs are retired untouched,
never destructively reset:

- `…0001` — original demo company (§2.4)
- `…e2e1` — original e2e test company
- `…b001`–`…b005` — original fixed integration-suite companies (post,
  year-end, audit-log, reverse, approval-rbac)

Old test companies accumulate as disposable rows in the non-prod Supabase
project; reclaiming that space is an infrequent, manual,
whole-environment reset (drop/recreate the test project) — never
something app code or the test suite does automatically.
*(Decisions #17, #18, #19 — this pattern was discovered three times
independently before being generalized into a standing policy; expect it
to keep applying to any future fixed-company test setup.)*

### 7.2 Verification baseline

**Current (2026-08-31, post–Module 1.1.C C1-5 quotation convert) — recount, not incremental drift:**

| Check | Result |
|---|---|
| npm run build | Pass |
| Full suite | **51 suites** / **535 tests** — **535/535 pass** after C1-5 (`npx jest`, 2026-08-31) |
| COA verify | node scripts/verify-reset-health.mjs — **7/7** on demo …0002 |
| Auth regression | **83/83** routes (`controller-auth-coverage.spec.ts`; 15 controllers incl. credit-notes + convert) |
| AuthModule wiring | `node scripts/verify-auth-module-imports.mjs` — **14/14** guarded controllers OK |
| Fresh DB setup | schema.sql top-to-bottom + seed_finalized_coa_demo_company_0002.sql |
| Excel TC1–TC14 | **14 PASS / 0 PARTIAL / 0 FAIL** (incl. #55/#56/#57 deltas) |
| `v_trial_balance` | `security_invoker=true` confirmed live; status filter uses `is_ledger_truth_status` (#60) |
| Recurring schedule | Nest `@Cron` EVERY_DAY_AT_1AM → `runDueGenerations` per company (#62); due claim via `generate_due_recurring_entry` / `rjt:` (#63) |
| Module 1.1.C | customers C1-1 + quotations C1-2 + invoices C1-3 + credit notes C1-4 + quotation convert C1-5 (see feature-spec-1_1_C.md) |
| Nest ledger-truth audit | #64 — grep of Nest `posted`-only filters: one bug fixed (`getProfitAndLossBalancesForFiscalYear`); remaining hits classified (period-edit guard, test counters — not aggregation) |

**§7.2 drift correction:** The post-#63 row still said **42/42** auth and **~42 suites** — that was already stale *before* C1-1/C1-2 (H1-era **42** routes never picked up **+5** customers or **+12** quotations). Authoritative recount above supersedes all prior §7.2 suite/auth totals; do not increment from the old 42 baseline.

Historical test-count chain (decision-time snapshots, not maintained incrementally):
30/314 (2026-08-28, post-#54) → 33/333 (#55–#58) → **34/339** (#59) → **39 suites** (H1 + #60) → **+2** scheduler (#62) → **+1** recurring concurrency (#63) → **+2** customers (#C1-1) → **+1** quotations (#C1-2) → **+1** invoices (#C1-3) → **+1** credit notes (#C1-4) → **+1** TB vs cnl co-load diagnostic → **+1** quotation convert (#C1-5) = **51 suites** verified 2026-08-31.
Auth: **38 → 42** (H1 report routes, 2026-08-29) → **47** (+5 customers, C1-1) → **59** (+12 quotations, C1-2) → **72** (+13 invoices, C1-3) → **82** (+10 credit notes, C1-4) → **83** (+1 convert, C1-5).
Older decision-log entries (#26–#49) record suite counts *at decision time* only.

### 7.3 Gap audit closure index

| Audit | Date | Closed | Decisions |
|---|---|---|---|
| Fresh-DB drift | 2026-08-25 | Table grants, auth gaps, companies RLS, JWT skew | #23–#29, #37 |
| §7.16 first sweep | 2026-08-27 | Membership guard; DTO identity; account/period/hierarchy validation; trial balance; triggers; grants | #41–#48 |
| §7.26 second sweep | 2026-08-28 | period_id FK; recurring auto_post; auth 37/37; hygiene | #50–#53 |
| §7.30 third sweep | 2026-08-28 | System-account deactivate; recurring_template_id FK; entry_date range | #54 |

**§7.16 findings → decisions:** (1) Nest membership #41; (2) CreateAccountDto system fields #42; (3) recurring company_id #43; (4) recurring line account_id #44; (5) parent_account_id #45; (6) balance trigger INSERT #46; (7) trigger EXECUTE grants #48; (8) trial balance route #47.

**§7.26 findings → decisions:** period_id #51; recurring auto_post #52; auth-coverage #53; UpdateJournalLineDto #50.

**§7.30 findings → decisions:** system-account deactivate; recurring_template_id same-company; entry_date within period — all #54.

---

## 8. Decision Log Index

Chronological, for traceability. Full rationale for each lives in the
topical section referenced.

| # | Date | Summary | Detail in |
|---|------|---------|-----------|
| 1 | 2026-08-21 | Owner bypasses approval workflow entirely | §4.1 |
| 2 | 2026-08-21 | An entry cannot be reversed twice | §4.2 |
| 3 | 2026-08-21 | Opening balance is one-time per company/fiscal year | §4.3 |
| 4 | 2026-08-21 | Year-end closing is one-time per company/fiscal year | §4.4 |
| 5 | 2026-08-21 | `normal_balance` is exactly `debit`/`credit`, lowercase | §1 |
| 6 | 2026-08-21 | Fixed-UUID demo company for seed/dev scaffolding | §2.4 |
| 7 | 2026-08-21 | Import Duty is `expense`/COGS; flag for Module 2.2 capitalization | §2.2 |
| 8 | 2026-08-21, **superseded 2026-08-22** | Zakat Reserve placement — originally logged as `equity` (AAOIFI appropriation reading); superseded the next day to `liability` as the default, with `equity` demoted to an opt-in custom account. Finalized with corrected naming in #12. | §2.2 |
| 9 | 2026-08-23 | A reversal entry cannot itself be reversed | §4.2 |
| 10 | 2026-08-23, **corrected same day** | `service_role`-only access; grant checklist. Correction: first grant attempt missed revoking `anon` — Supabase auto-grants execute to `anon`/`authenticated`/`service_role` on every new function by default. Hardened via `ALTER DEFAULT PRIVILEGES`. | §5.1 |
| 11 | 2026-08-23 | `company_members`/`company_role` is minimal, not full RBAC; only Owner/Manager enforced in this module | §5.2 |
| 12 | 2026-08-24 | Zakat naming finalized to match the real COA file exactly (`2350 Zakat Payable` / `3300 Zakat Reserve`), correcting #8's literal wording | §2.2 |
| 13 | 2026-08-24 | Import Duty is two accounts (`2800` liability + `5030` expense), extending #7 | §2.2 |
| 14 | 2026-08-24 | `Account Nature`/`VAT Mapping` folded into `description`, no schema columns added | §2.1 |
| 15 | 2026-08-24 | Four hierarchy-demonstration accounts chosen | §2.3 |
| 16 | 2026-08-24 | `3100 Retained Earnings` marked `is_system_account = true` | §2.2 |
| 17 | 2026-08-24 | Original demo company (`…0001`) retired after reseed correctly aborted (228 posted `journal_lines`); new demo company `…0002` minted. Same-day addendum: identical issue hit the e2e company (`…e2e1`, 589 lines) — same fix, `…e2e2` minted. | §2.4, §7 |
| 18 | 2026-08-24 | E2E "teardown" resolved as a UUID-rotation policy, not a delete path — random UUID per run going forward | §7 |
| 19 | 2026-08-24 | #18's rotation policy extended to all five fixed-company integration suites after the identical wall hit `…b004` (reverse suite) — third occurrence in one day | §7 |
| 20 | 2026-08-24 | Race conditions (entry-number allocation, opening-balance, year-end) fixed via advisory-lock RPCs | §6 |
| 21 | 2026-08-24 | DTO spoofing audit found `AccountingPeriodsController` had no auth guard at all — fixed | §5.3 |
| 22 | 2026-08-24 | `v_trial_balance` found live as `SECURITY DEFINER` despite a prior "fixed" report — re-fixed and documented as non-negotiable | §5.4 |
| 23 | 2026-08-24 | Fresh Supabase projects don't auto-grant `service_role` table access — explicit grant block added (`schema.sql` §12) | §5.5 |
| 24 | 2026-08-24 | Auth-guard gap found broader than #21 covered — entire `accounts` and `audit-log` controllers, most `journal-entries` read routes, most `recurring-journal-templates` routes all unguarded; fix takes priority over stub completion | §5.6 |
| 25 | 2026-08-24 | `companies` has no RLS policy — safe today (service_role-only grants) but documented as a latent gap, not fixed yet | §5.7 |
| 26 | 2026-08-25 | Fresh-DB drift verification closed — 3x consecutive clean full suite (128 tests) on a fresh Supabase project | §7.2 |
| 27 | 2026-08-25 | `JournalLinesController` had no auth guard after #24 — fixed with controller-level `SupabaseAuthGuard` (same pattern as #21); no identity-field DTO changes needed; `prevent_posted_line_mutation` INSERT gap flagged, not fixed | §5.8, §7.2 |
| 28 | 2026-08-25 | `prevent_posted_line_mutation` extended to fire on INSERT, closing the gap #27 flagged; applied to `schema.sql` and live DB, confirmed matching; test helpers relying on the now-illegal "insert as posted" sequence rewritten to draft→lines→post; transient parallel-worker JWT clock-skew issue found and flagged (not fixed) | §5.9, §7.3 |
| 29 | 2026-08-25 | `companies` had no RLS at all (#25) — closed with membership-based `company_isolation_companies` policy via `company_members`/`auth.uid()`, SELECT-only grant to `authenticated`; verified with real anon/authenticated/service_role JWTs; backend paths unchanged | §5.10, §7.3 |
| 30 | 2026-08-25 | Accounting-periods create/list/update implemented against actual schema (no period label/number column exists); overlap + posted-activity checks are service-layer only (no DB exclusion constraint), flagged as a low-priority concurrent-write race; soft-close remains the only status-transition path; app-layer only, no live-DB apply | §4.5, §7.3 |
| 31 | 2026-08-26 | Journal-entries list + draft header PATCH; required `company_id` query (+ optional status/period_id); header fields only while draft; no status/identity side door; schema has no posted-header UPDATE trigger (flagged, not fixed); `createLine` still out of scope | §4.6, §7.3 |
| 32 | 2026-08-26 | `createLine` (`POST /journal-lines`) implemented; debit/credit XOR + posted-parent rejection enforced via existing constraints/#28 trigger, surfaced cleanly; no same-company/active-account check on `account_id` (flagged, matches existing gap in `insert_journal_entry_draft`); `deleteLine` has service/repo support but no route (flagged, not built) | §4.7 |
| 33 | 2026-08-26 | Test-setup only: `ensureCompanyWithCoa` COA clone changed from per-row inserts to one batched insert (~183 accounts); no product/behavior change; full-suite wall ~953s → ~276–297s (3x clean), per-mint insert ~53s → ~0.55s | §7.2 |
| 34 | 2026-08-27 | `DELETE /journal-lines/:id` wired to existing `deleteLine` method; posted-parent DELETE blocked by #28 trigger as 400; closes the route gap #32 flagged | §4.7 |
| 35 | 2026-08-27 | Shared same-company + `is_active` validation added for `createLine` and `insert_journal_entry_draft` account_id; `create_opening_balance_entry` and `updateLine` account_id left flagged, not in scope; FK unchanged | §4.8 |
| 36 | 2026-08-27 | `PATCH /accounts/:id` implemented — metadata fields only (`account_name`, `sub_category`, `description`); structural/identity/hierarchy fields rejected by DTO; system-account UPDATE protection is service-layer only, no DB trigger (flagged) | §4.9 |
| 37 | 2026-08-27 | Closed §5.9 JWT clock-skew via a shared fetch-level retry wrapper on `SupabaseService`'s secret-key client (matches only `PGRST303`/"JWT issued at future"; 5 attempts, `250ms*attempt`); no legacy `service_role` key swap; `ensureAuthUser`'s old retry removed as redundant; `--runInBand` no longer required — verified in genuine parallel mode, ~953s baseline → ~105s | §5.9, §7.2 |
| 38 | 2026-08-27 | DB-level defense-in-depth added for the two remaining service-layer-only gaps: `accounting_periods_company_daterange_excl` (btree_gist exclusion constraint, closes #30's period-overlap flag) and `trg_prevent_nondraft_header_mutation` (BEFORE UPDATE trigger, closes #31's posted-header flag); both confirmed live; existing service-layer checks retained; verified in parallel mode | §4.10 |
| 39 | 2026-08-27 | Closed §4.9's *originally flagged* call sites: `create_opening_balance_entry` and `updateLine` (when `account_id` changes) now reuse `assertAccountsUsableForCompany` unchanged; same 400 shape as #35; `createLine`/draft-insert untouched. **Note:** a later audit found a 5th call site (recurring-template lines) not covered here — see §7.16 finding #4 | §4.8 |
| 40 | 2026-08-27 | Security Advisor: move `btree_gist` (and other extensions) to schema `extensions`; move `is_company_member` to `private` (drop public RPC surface); revoke EXECUTE from `anon`. **Unrelated to the membership-enforcement gap found in the same day's later audit (§7.16) — does not close it.** | §5.10 |
| 41 | 2026-08-27 | Closed Nest cross-tenant membership gap (audit §7.16 finding #1): shared CompanyMembershipGuard + @RequireCompanyMembership on every tenant-scoped route; post/approve/reject reuse guard-resolved role (no duplicate lookup); accounts/recurring list + run-due require company_id; 403 for non-members | §5.11 |
| 42 | 2026-08-27 | Closed §7.16 finding #2: `CreateAccountDto` no longer accepts `is_system_account`/`locked_at`/`locked_reason` from the client; repository insert hardcodes system defaults as defense in depth | §4.11 |
| 43 | 2026-08-27 | Closed §7.16 finding #3: `UpdateRecurringJournalTemplateDto` rebuilt as purpose-built (no longer `PartialType` of create DTO); `company_id`/`created_by`/`lines`/`id`/timestamps all rejected; repository update no longer writes `company_id` | §4.12 |
| 44 | 2026-08-27 | Closed §7.16 finding #4: recurring template lines' 5th account_id call site (`insert`/`insertLine`/`updateLine`) now uses the shared `assertAccountsUsableForCompany` helper, matching #35/#39 | §4.13 |
| 45 | 2026-08-27 | Closed §7.16 finding #5: `enforce_account_hierarchy_depth` extended to check `parent_account_id`'s `company_id`, DB-layer only, consistent with #28/#38's defense-in-depth pattern; `schema.sql` §2 confirmed synced | §4.14 |
| 46 | 2026-08-28 | Closed §7.16 finding #6: `trg_enforce_journal_balance_on_post` extended to `BEFORE INSERT OR UPDATE` with explicit `tg_op = 'INSERT'` branch; no RPC changes — backstop only | §4.15 |
| 47 | 2026-08-28 | Closed §7.16 finding #8: `GET /accounts/:id/trial-balance` exposes single-account `v_trial_balance` via existing `getAccountTrialBalance`; membership from account param (#41) | §4.16 |
| 48 | 2026-08-28 | Closed §7.16 finding #7: §5.1 EXECUTE-revoke/grant on all nine trigger helpers; empirical PGlite test proves EXECUTE does not gate trigger firing; hygiene only | §4.17 |
| 49 | 2026-08-28 | Post-reset health check: build + full suite 3× clean + COA verify 7/7 | §7.2 |
| 50 | 2026-08-28 | Second gap audit §7.26: hygiene — purpose-built `UpdateJournalLineDto`, removed dead trial-balance method, README drift | §7.3 |
| 51 | 2026-08-28 | Closed §7.26 finding #1: `assertPeriodUsableForCompany` in `insertJournalEntryDraftRpc` (all draft-create paths); mirrors #35 account pattern | §4.18 |
| 52 | 2026-08-28 | Closed §7.26 finding #2: recurring `auto_post=true` uses `JournalEntriesService.post()` — does not bypass approval threshold or soft-close authorization | §4.1 |
| 53 | 2026-08-28 | Closed §7.26 finding #3: `controller-auth-coverage.spec.ts` expanded to 37/37 routes (401 + authenticated membership probes) | §7.3 |
| 54 | 2026-08-28 | Closed §7.30 third audit: system-account deactivate block; `recurring_template_id` + `entry_date` draft-create integrity | §4.9, §4.18 |
| 55 | 2026-08-29 | Self-approval labeled at write time: `log_journal_entry_change` sets `audit_log.notes = 'Self-approved by Owner'` when `approved_by = created_by` on transition into approved/posted; Owner self-post stamps `approved_by`; two-person Owner approval leaves notes null | §4.1 |
| 56 | 2026-08-29 | Blocked hard-delete of posted journal entries/lines writes `audit_log` with `delete_blocked` in a separate Nest transaction after catching `POSTED_ENTRY_DELETE_BLOCKED` / `POSTED_LINE_DELETE_BLOCKED`; enum + trigger tokens in schema.sql; DELETE /journal-entries/:id | §3, §4.7, §5.12 |
| 57 | 2026-08-29 | Opening balance rejects income/expense account lines — Nest `assertOpeningBalanceAccountsUsable` + RPC `OPENING_BALANCE_INVALID_ACCOUNT_CATEGORY` (balance-sheet accounts only) | §4.3, §6 |
| 58 | 2026-08-29 | System-account structural UPDATE DB backstop: `trg_prevent_system_account_mutation` blocks §4.9 structural/identity columns when `is_system_account = true`; metadata allowed; Nest PATCH still blocks all system-account updates; closes known-open-item | §4.9, §4.17 |
| 59 | 2026-08-29 | Integrity sweep: live behavioral re-verify of enums/constraints/triggers/RPC tokens/RLS proxies; permanentized Jest coverage for previously untested branches (system delete, draft delete allow, zero-line post, equity/income band mismatch, JOURNAL_DRAFT_REQUIRES_LINES, NO_OPEN/NO_PERIOD, OB income on first line, reverse-a-reversal); Excel TC13/TC14 extended for #57/#56 line delete; no product defects found — catalog SQL (pg_enum / role_routine_grants / security_invoker reloption) still requires DATABASE_URL | §7.2 |
| 60 | 2026-08-30 | `v_trial_balance` status filter was a no-op (status in LEFT JOIN ON); rewritten to sum only `is_ledger_truth_status` lines via subquery LEFT JOIN; `security_invoker` retained; live `GET /accounts/:id/trial-balance` regression coverage | §5.4, §4.16, §7.2 |
| 61 | 2026-08-30 | `create_year_end_closing_entry` P&L aggregation switched from `status = 'posted'` to `is_ledger_truth_status` (posted ∪ reversed) + `account_signed_balance`, lockstep with H1 P&L; posted-only dropped reversed originals while keeping reversing entries and transferred the wrong amount to 3100 (found by H1-5 cross-report sweep) | §6, §4.4 |
| 62 | 2026-08-30 | Recurring templates: add Nest `@nestjs/schedule` daily `@Cron` (`RecurringJournalSchedulerService`, 01:00 UTC) iterating every company with ≥1 active template via existing `runDueGenerations`; per-company failure isolation + run summary logs; manual `POST …/run-due` and `…/generate` unchanged. Concurrent scheduled+manual race left open in this pass (closed by #63). Closes the “no unattended scheduler” gap vs §3’s prior overstated reading | §3, §4.1, §7.2 |
| 63 | 2026-08-30 | Recurring due generation: `generate_due_recurring_entry` SECURITY DEFINER RPC with `pg_advisory_xact_lock(hashtext('rjt:' \|\| template_id))` — re-reads `next_run_date` under lock, skips if already claimed, inserts draft via `insert_journal_entry_draft`, advances schedule in the same transaction. Cron (#62) and manual run-due/generate share the RPC; Nest `#52` post unchanged (balance-delete reverts schedule). Concurrent same-template / cron-vs-manual → one entry; different templates do not serialize. Follows #20 `ob:`/`ye:` pattern | §3, §4.1, §6, §7.2 |
| 64 | 2026-08-31 | Nest `getProfitAndLossBalancesForFiscalYear` still used hand-rolled `status = posted` aggregation after #61 moved year-end close + H1 to `is_ledger_truth_status`; broke Stage 11 E2E (`plAfterClose` phantom −4,000 after reversal). Fix: delegate to `get_profit_and_loss` RPC for fiscal-year date bounds — no fifth Nest copy of ledger-truth rules. TS Nest grep audit (same discipline as post-#61 SQL sweep): only other `posted`-only hits are `hasPostedJournalActivity` (period header-edit guard, §4.5 — correct) and Excel TC8 recurring entry counter (not ledger aggregation) | §4.4, §7.2 |