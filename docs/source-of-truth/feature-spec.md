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
  — set frequency and auto-post
- Journal approval workflow: Owner must approve entries above a
  configurable AED threshold
- Period soft-close with override permission for corrections by authorised
  users
- Year-end closing: auto-transfer of P&L balances to retained earnings
  account
- Reversing journal entries: one-click reversal in the next period
- Opening balance entry: historical import for companies setting up
  mid-year
- Immutable audit trail: all entries logged — reversals only, no deletions
  ever

---

## 4. Journal Entry Lifecycle Rules

These are hard rules resolving gaps not covered by the Accounting Rules
PDF — treat as settled, not open questions.

### 4.1 Approval workflow

**Owner role bypasses the approval workflow entirely**, regardless of
entry amount or who created the entry — including approving/posting their
own entries. The Owner is the ultimate accountable party. The
`pending_approval → approve` flow applies only when the original poster
is NOT an Owner. *(Decision #1)*

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

### 4.4 Year-end closing

**One-time per company per fiscal year.** It posts real entries
transferring P&L into Retained Earnings — running it twice would
double-transfer. A second `year_end_closing` entry for the same
company + fiscal year is rejected outright, with no partial cleanup
attempted. *(Decision #4; RPC enforcement in §6)*

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

### 5.4 `v_trial_balance` security-invoker regression

`v_trial_balance` was live-flagged by Supabase's linter as
`SECURITY DEFINER` — meaning its RLS checks ran as the view owner, not
the querying role, silently bypassing the `company_isolation_*` policies
that are this project's core multi-tenant guarantee. This had previously
been reported fixed, but the fix was never captured back into
`schema.sql` (or was lost) — a live example of exactly the kind of drift
§7's fresh-DB verification item exists to catch.

**Fixed:** `with (security_invoker = true)` added to the view definition
in `schema.sql` §9; applied live via
`ALTER VIEW v_trial_balance SET (security_invoker = true);`. Treat this
clause as non-negotiable on any future edit of this view. *(Decision #22)*

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

**Fixed:** `schema.sql` §12 adds an explicit grant block (table
select/insert/update/delete, sequence usage/select, plus
`alter default privileges` so future tables/sequences inherit the same
grants automatically) — kept in sync with a standalone
`apply_data_api_grants.sql` for one-shot re-application to any other
fresh/live project. *(Decision #23)*

### 5.6 Auth-guard coverage — broader gap than decision #21 addressed

The fresh-DB verification pass surfaced that decision #21's fix was
correctly scoped to what it found, but **not exhaustive across the whole
codebase** — the same missing-`SupabaseAuthGuard` pattern exists more
widely:
- The entire `accounts` controller
- `journal-entries`: `GET` (list), `GET :id`, attachments, `PATCH`
- Most `recurring-journal-templates` routes (`run-due`, list, update,
  delete, generate, lines)
- The entire `audit-log` controller

**What's already correctly guarded** (unaffected): every journal mutation
that actually matters for ledger integrity — create, post, approve,
reject, reverse, opening-balance, year-end-close — plus period soft-close
(§5.3). So this is a **read-path and completeness gap**, not a ledger-
integrity gap — no unguarded route can post, alter, or corrupt financial
data. But per §5.1's own model (the backend is the only remaining safety
net once `service_role` bypasses RLS), any endpoint reachable without a
session is a potential cross-company data read, regardless of whether it
mutates — `audit_log` and `accounts` being fully unguarded is a real
exposure, not a cosmetic one.

**Priority call:** consistent with #21 and #22 both being treated as
blocking the moment they were found (ahead of feature-completion work),
this gets the same treatment — fix with the identical controller-level-
guard pattern as #21, across every controller listed above, before
treating any remaining stub-endpoint work as the next priority.
*(Decision #24)*

### 5.7 `companies` table has no RLS policy — documented, not fixed

`companies` itself has no row-level security policy (§8's RLS section
covers every *other* multi-tenant table). This is currently safe only
because `service_role` — which bypasses RLS entirely — is the sole role
with grants on it (§5.1, §5.5). It's a **latent gap, not an active one**:
if `anon` or `authenticated` are ever granted table access (accidentally,
or for a legitimate future feature), `companies` would have zero tenant
isolation, unlike every other table in this schema. Not fixed now,
because a real fix means designing a `companies`-level RLS policy
(plausibly membership-based via `company_members`), which is either
Module 1.6 RBAC territory or needs its own short design pass — flagged
for the next security review rather than left silently unnoted.
*(Decision #25)*

---

## 6. Concurrency — Advisory-Lock RPCs

Three check-then-act patterns had no atomicity guarantee under concurrent
load: `getNextEntryNumber()`, opening-balance creation, and year-end
closing. Fixed via `pg_advisory_xact_lock`-based `SECURITY DEFINER` RPCs
(grants follow §5.1's checklist exactly on all five):

| RPC | Purpose |
|---|---|
| `allocate_next_entry_number(company_id)` | Company-scoped lock + `max(entry_number)+1`. Must be called inside the same transaction as the subsequent insert. |
| `insert_journal_entry_draft(...)` | Atomic draft insert (manual + recurring-generated entries) using the allocator above. |
| `create_opening_balance_entry(...)` | Full check→period-lookup→allocate→insert→post sequence, one transaction. |
| `create_year_end_closing_entry(...)` | Full check→P&L-line-build→allocate→insert→post sequence, one transaction. |
| `reverse_journal_entry(...)` | Existing reversal RPC, updated to call the shared allocator instead of its own inline `max+1`. |

**Lock key convention:**
- Entry-number allocation: `hashtext(company_id)` — global per company.
- Opening balance: `hashtext('ob:' || company_id || ':' || fiscal_year)`.
- Year-end closing: `hashtext('ye:' || company_id || ':' || fiscal_year)`.
- `ob:` and `ye:` namespaces do **not** block each other — no rule
  requires opening-balance and year-end operations to serialize against
  one another.
- **Lock order is always: namespace lock (`ob:`/`ye:`) first, then the
  nested entry-number lock** — this ordering is fixed to avoid deadlocks
  between concurrent operations.

**Exception token contract** (NestJS maps these to clean HTTP errors):

| Token | Raised by |
|---|---|
| `OPENING_BALANCE_ALREADY_EXISTS` | opening-balance existence check |
| `YEAR_END_ALREADY_CLOSED` | year-end existence check |
| `NO_OPEN_PERIOD_FOR_FISCAL_YEAR` | opening-balance's earliest-*open*-period lookup |
| `NO_PERIOD_FOR_FISCAL_YEAR` | year-end's latest-period lookup (any status — distinct from the token above) |
| `RETAINED_EARNINGS_NOT_FOUND` | year-end can't find account `3100` |
| `NO_PL_BALANCES_TO_CLOSE` | year-end finds nothing to close |
| `NO_NEXT_OPEN_PERIOD` | reversal can't find a next open period |
| `JOURNAL_DRAFT_REQUIRES_LINES` | any insert called with no lines |

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

### 7.1 Fresh-DB drift verification — status

**Closed 2026-08-25.** Fresh Supabase project (`cuqnkorfhzydxwzkbjlv`),
`schema.sql` applied top to bottom, real findings surfaced along the way
(§5.5 missing table grants, §5.6 broader auth-guard gap, §5.7 documented
`companies` RLS risk acceptance) plus one incidental Jest default-timeout
fix (integration suites' `mintFreshIntegrationCompany` COA-clone setup
exceeds the 5000ms default; raised to `180_000` to match Stage 13/
advisory-lock's existing pattern — five files: `post`, `reverse`,
`approval-rbac`, `year-end-closing`, `audit-log` integration specs).

**Final proof:** full suite (16 suites / 128 tests — unit, all five
integration suites, advisory-lock concurrent suite, Stage 13 e2e) run 3x
consecutive clean against the fresh project. Trial balance landed on the
identical `88600.00` across all 3 runs on 3 independently-minted e2e
companies — confirms the deterministic test script, not stale/leaked
data. This is the first time this project has had actual proof, not
inference, that `schema.sql` and a live database match from a cold start.
*(Decision #26)*

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
| 26 | 2026-08-25 | Fresh-DB drift verification closed — 3x consecutive clean full suite (128 tests) on a fresh Supabase project | §7.1 |