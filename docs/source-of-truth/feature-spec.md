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

### Known open items (quick reference)

Everything below is a **known, flagged, accepted state** — not an
oversight — but each is a real gap worth re-checking before it's assumed
fixed by default. Kept in one place specifically so none of these repeat
this project's own recurring failure mode: a flagged item quietly
forgotten until rediscovered the hard way (see decision #22).

**Closed 2026-08-27 by decision #41:** Nest company-membership enforcement
on every tenant-scoped route (was the critical §7.16 finding #1). See §5.11.
**Closed 2026-08-27 by decision #42:** `CreateAccountDto` no longer
accepts `is_system_account`/`locked_at`/`locked_reason` from the client
(was §7.16 finding #2). See §4.12.

| Gap | Why it's not fixed yet | Detail |
|---|---|---|
| Accounts: no service-layer block on UPDATE to `is_system_account` accounts at the DB level | `trg_prevent_account_deletion` is DELETE-only; UPDATE protection is service-layer only (#36) | §4.10 |
| `UpdateRecurringJournalTemplateDto` can reassign `company_id` via `PartialType` | Found by the 2026-08-27 audit | §7.16 finding #3 |
| Recurring-template line inserts skip `assertAccountsUsableForCompany` (5th call site) | Same class of gap #35/#39 fixed for 4 other call sites; this one wasn't covered | §7.16 finding #4 |
| `accounts.parent_account_id` not validated as same-company | Found by the same audit | §7.16 finding #5 |
| `trg_enforce_journal_balance_on_post` is UPDATE-only — INSERT as `posted` bypasses it | Same shape as the pre-#28 posted-line INSERT gap | §7.16 finding #6 |
| Trigger helper functions lack the §5.1 EXECUTE-revoke checklist | Found by the same audit | §7.16 finding #7 |
| `getAccountTrialBalance` has a service method but no HTTP route | Found by the same audit | §7.16 finding #8 |

Findings #3–#8 remain queued (#1 closed by #41, #2 closed by #42).

**Note on test execution:** `--runInBand` was required from decision #28
through #36 due to a JWT clock-skew issue — that issue is now closed
(decision #37, §5.9/§7.12). Any verification numbers logged before #37
that mention `--runInBand` reflect the requirement *at the time*, not a
constraint still in effect today.

Stub endpoints still outstanding (not gaps, just unbuilt): hard-close/
reopen HTTP; close checklist (Rules §1.22).

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

## 4. Journal Entry & Period Lifecycle Rules

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

**Enforcement layer:** `schema.sql` has `unique(company_id, period_start,
period_end)` (exact-match only) and `check(period_end > period_start)`,
but **no overlap-exclusion constraint or trigger**. Both the overlap
rejection and the posted-activity edit block are enforced in the service
layer only, not the database — per this project's standing rule (§5.1
lineage: don't add a schema/DB change without an explicit ask), this was
deliberately left as an app-layer check rather than a new constraint.

**Flagged, not fixed:** because overlap rejection is service-layer only,
two concurrent `POST /accounting-periods` requests for the same company
with overlapping dates are not guaranteed to be mutually exclusive — the
same class of race §6's advisory-lock RPCs exist to prevent for entry
numbering, opening balance, and year-end closing. Period creation is
low-frequency and low-concurrency by nature, so this is a low-priority
gap, not an urgent one — but it's a known, accepted state, not an
oversight, and worth revisiting (likely a `tstzrange` exclusion
constraint) if period creation ever becomes concurrent/automated.
**Closed by decision #38 (§4.11) — see there for the exclusion
constraint added.**

**Verification:** full suite 3x consecutive clean (18 suites / 164 tests
— 137 prior post-#29, minus RLS-suite overlap accounted for, plus new
periods coverage), `--runInBand`, on `cuqnkorfhzydxwzkbjlv`. No live-DB
apply required — app-layer change only. *(Decision #30)*

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
  `status`, `company_id`, `period_id`, lines, and all identity/actor
  fields (`created_by`, `approved_by`, `rejected_by`, `posted_at`, …)
  are rejected by DTO whitelisting + `forbidNonWhitelisted`. Status
  transitions remain exclusively on post / approve / reject / reverse.
  Allowed only while `status = 'draft'`; once posted (or beyond),
  reversal is the only correction path (§4.2). `uploaded_by` for any
  attachment replacement comes from `@CurrentUser()`, never the body.
- **Out of scope:** `createLine`, line mutations, any other controller.

**Enforcement layer:** draft-only header editability is service-layer
(plus an optimistic `.eq('status','draft')` filter on the UPDATE itself).
Per standing rule (§5.1 lineage: no schema/DB change without an explicit
ask), no new header-immutability trigger was added.

**Flagged, not fixed:** `schema.sql` does not prevent a direct UPDATE of
a posted journal entry's header (narration/date/etc.) via PostgREST or a
bypassed service path — the same class of "service-layer only" gap §4.5
flagged for period overlap. Harmless for normal API use while the
service-layer check holds; worth a dedicated `BEFORE UPDATE` trigger if
defense-in-depth at the DB is wanted later. **Closed by decision #38
(§4.11) — see there for the trigger added.**

**Auth:** class-level `@UseGuards(SupabaseAuthGuard)` on
`JournalEntriesController` (already in place per §5.6/#24) confirmed to
cover both new routes.

**Verification:** full suite 3x consecutive clean (19 suites / 180 tests),
`--runInBand`, on `cuqnkorfhzydxwzkbjlv`. App-layer only — no live-DB
apply. *(Decision #31)*

### 4.11 DB-level defense-in-depth: period overlap + posted-header immutability (#38)

Closes both flagged service-layer-only gaps at once, since they share
the same shape: §4.5's period-overlap check and §4.6's posted-header
UPDATE check now have a DB backstop, not just an application-layer
check. Both service-layer checks are retained unchanged — the DB
constraints are a backstop for anything that bypasses the service layer
(a direct PostgREST call, a bug, a future code path that forgets the
check), not a replacement for the normal-path 400/409 the service layer
already produces.

**Accounting periods:** an exclusion constraint,
`accounting_periods_company_daterange_excl`, using the `btree_gist`
extension (enabled as part of this change) to prevent overlapping
`(period_start, period_end)` ranges for the same `company_id` at the DB
level. A direct overlapping INSERT now fails with Postgres error
`23P01`, confirmed via a live probe, independent of whether the service
layer's check is bypassed.

**Journal entries:** a new trigger,
`trg_prevent_nondraft_header_mutation`, `BEFORE UPDATE` on
`journal_entries`, rejecting header-field mutation (`narration`,
`reference_number`, `entry_date`, attachments) whenever `status !=
'draft'` — mirroring the existing `trg_prevent_posted_line_update` (#28)
error style for consistency. Legitimate system-driven transitions
(`status`, `approved_by`, `posted_at`, and the rest of the
approve/reject/post/reverse flow) are unaffected — the trigger only
blocks unauthorized header edits after draft, not the state-machine
transitions those flows already perform correctly.

**Live apply:** both changes required a live-DB apply (no automated
migration runner, per #28/#29's precedent) — confirmed live via a
direct probe (exclusion constraint returns `23P01` on overlap) and via
`pg_get_triggerdef` matching `schema.sql` for the new trigger.

**Verification:** full suite 3x consecutive clean (21 suites / 216
tests), run in genuine parallel mode (`--maxWorkers=50%`, no
`--runInBand` — no longer required since #37) — **~122s / ~115s / ~115s**
per run, on `cuqnkorfhzydxwzkbjlv`. *(Decision #38)*

### 4.7 Journal line create — `POST /journal-lines` (#32)

`journal_lines` columns, per `schema.sql`: `id`, `journal_entry_id`,
`line_number`, `account_id`, `debit` / `credit` (`numeric(18,2)`, `>= 0`,
with a check enforcing exactly one side positive — never both, never
neither), optional `description` / `cost_center`, `created_at`. Unique
`(journal_entry_id, line_number)`.

`trg_enforce_journal_balance_on_post` fires only on transition to
`posted` — a draft entry is allowed to be unbalanced while lines are
still being added, so `createLine` does not need to check running
balance. `trg_prevent_posted_line_update` (extended to cover INSERT by
decision #28) rejects mutation only when the parent's status is
`posted` specifically — not any non-draft status generally.

- **Route:** `POST /journal-lines`, body carries `journal_entry_id`
  (no path param); existing `CreateJournalLineDto`.
- **DTO:** no identity/actor fields (confirmed already absent per #27's
  audit) — whitelist rejects any spoofed field regardless.
- **Posted-parent rejection:** the `#28` DB trigger error is surfaced
  cleanly (400) via the existing `handleDatabaseError` path, not
  re-implemented in the service — confirmed through `createLine` itself,
  not only the raw-insert regression test #28 already had.
- **Auth:** class-level `@UseGuards(SupabaseAuthGuard)` (#27) covers
  the route.

**Flagged, not fixed:** `createLine` does not validate that `account_id`
belongs to the same company as the parent journal entry, or that the
account is active (`is_active = true`) — only the FK constraint is
enforced. This matches the existing behavior of
`insert_journal_entry_draft`, which has the identical gap, so this isn't
a new inconsistency — but both share the same underlying risk (a
cross-company or deactivated account slipping onto a journal line) and
would need to be fixed together if addressed at all — **closed for both
`createLine` and `insert_journal_entry_draft` by decision #35 (§4.9)**;
`create_opening_balance_entry` and `updateLine` remain flagged (see §4.9).

**`deleteLine` route:** was missing at the time of this decision — closed
by decision #34 (§4.8).

**Verification:** full suite 3x consecutive clean (19 suites / 186 tests),
`--runInBand`, on `cuqnkorfhzydxwzkbjlv`. *(Decision #32)*

### 4.8 Journal line delete — `DELETE /journal-lines/:id` (#34)

Closes the gap §4.7 flagged: `deleteLine` already existed on the service
and repository (raw `.delete().eq('id', id)`, with `handleDatabaseError`
mapping `P0001` → 400) but had no HTTP route.

- **Route:** `DELETE /journal-lines/:id` on `JournalLinesController`,
  wired to the existing `deleteLine` method (204 on success).
- **Posted parent:** `trg_prevent_posted_line_update` (#28, `BEFORE
  INSERT OR UPDATE OR DELETE`) rejects DELETE when the parent's status
  is `posted`; surfaced as 400 — same pattern as `createLine` (#32).
  Confirmed through the service path this new route calls, not only via
  the raw trigger.
- **Auth:** class-level `@UseGuards(SupabaseAuthGuard)` (#27) covers
  the route.
- **Out of scope:** `createLine` / `updateLine` unchanged.

**Verification:** full suite 3x consecutive clean (19 suites / 190 tests),
`--runInBand`, on `cuqnkorfhzydxwzkbjlv`. *(Decision #34)*

### 4.9 Journal line `account_id` company + active checks (#35)

Closes the gap §4.7/#32 flagged, for the two client write paths that
accept an arbitrary `account_id` onto `journal_lines`:

1. `createLine` → `insertLine`
2. `insert_journal_entry_draft` (via `insertDraft` and
   `insertGeneratedFromTemplate`)

Rejects with **400** when the referenced account doesn't exist, its
`company_id` differs from the parent entry/company, or `is_active =
false`. The underlying FK constraint is unchanged — this is an
additional application-level check, not a schema change.

**Implementation:** a single shared helper,
`assertAccountsUsableForCompany` (`journal-line-account.validation.ts`),
called from the journal-entries repository on both write paths (before
the draft RPC call, and before the line INSERT) — one rule
implementation, not duplicated logic, and no `AccountsModule` refactor
required.

**Flagged, not fixed in this pass:** `create_opening_balance_entry` has
the identical class of gap (it also accepts client-supplied
`p_lines.account_id` values) but is a separate RPC and was out of scope
here. `updateLine` can still change a line's `account_id` without these
checks. Year-end and reversal line inserts are unaffected — they copy
system-resolved accounts, not raw client-supplied IDs, so they were
never exposed to this gap. **Both closed by decision #39 below.**

**Verification:** full suite 3x consecutive clean (20 suites / 196 tests),
`--runInBand`, on `cuqnkorfhzydxwzkbjlv`. *(Decision #35)*

**§4.9 closure (2026-08-27, decision #39).** Closed the two remaining
call sites flagged above, reusing `assertAccountsUsableForCompany`
unchanged — no new validation logic written, since the existing helper
already covered exactly what these two paths needed:

- `create_opening_balance_entry` now validates every line's `account_id`
  before the RPC proceeds to insert.
- `updateLine` validates only when the update payload actually includes
  a new `account_id` — an update that doesn't touch `account_id` doesn't
  pay the extra check.

Same 400 error shape as #35's original two call sites, for consistency.
`createLine` and `insert_journal_entry_draft` untouched.

This closes the last remaining item from §4.9's original flag list at
the time. **A comprehensive later audit (2026-08-27, see the Known Open
Items note at the top of this document) found a fifth call site —
recurring-template line inserts — that also skips this check; that is a
new, separate finding, not a regression of this decision, and remains
open pending a future decision.**

**Verification:** full suite 3x consecutive clean (21 suites / 218
tests), parallel mode, on `cuqnkorfhzydxwzkbjlv` (~113–119s per run).
*(Decision #39)*

### 4.10 Accounts update — `PATCH /accounts/:id` (#36)

`accounts` columns and their editability, per `schema.sql`:

| Column(s) | Editable via this PATCH? | Why |
|---|---|---|
| `account_name`, `sub_category`, `description` | Yes | Descriptive metadata only |
| `account_number`, `category`, `normal_balance` | No | Structural — changing these would corrupt the account-numbering scheme (§1) and historical reporting |
| `parent_account_id`, `depth` | No | Hierarchy identity |
| `is_system_account`, `company_id` | No | Identity / protection flags |
| `is_active` | No | Handled by the existing dedicated deactivate route, not this endpoint |

`cost_center` lives on `journal_lines`, not `accounts` — not applicable
here.

- **DTO:** a purpose-built `UpdateAccountDto` (not `PartialType(CreateAccountDto)`)
  whitelisting only the three editable fields above — structural fields
  are rejected outright by the DTO itself, not just by service logic.
- **System accounts:** `trg_prevent_account_deletion` is **DELETE-only**
  at the DB level — it does not block UPDATE. System-account protection
  on UPDATE (e.g. preventing `3100 Retained Earnings`'s metadata from
  being edited) is enforced at the **service layer only**. Flagged, not
  a DB-level guarantee — consistent with this project's existing
  service-layer-only gaps (period overlap §4.5, posted-header update
  §4.6).
- **Auth:** class-level `@UseGuards(SupabaseAuthGuard)` (#24) already
  covers the route.

**Note:** the same comprehensive audit that found the fifth
`account_id`-validation call site (§4.9) also found that
`CreateAccountDto` (the create path, not this update path) accepted
`is_system_account`, `locked_at`, and `locked_reason` from the client —
a separate finding, closed below in §4.12.

**Verification:** full suite 3x consecutive clean (20 suites / 206 tests),
`--runInBand`, on `cuqnkorfhzydxwzkbjlv` (3 runs: ~286s, ~292s, ~284s).
*(Decision #36)*

---

### 4.12 Account creation — system-controlled fields locked down (#42)

`§7.16` finding #2: `CreateAccountDto` accepted `is_system_account`,
`locked_at`, and `locked_reason` directly from the client — all three are
meant to be system-controlled, not client-chosen:

- `is_system_account` is set once at seed time (e.g. `3100 Retained
  Earnings`, decision #16) — never settable via a client create request.
- `locked_at` / `locked_reason` belong to the account-locking mechanism
  (deactivation on transaction history) — not freely chosen at creation.

**Fixed:** all three fields removed from `CreateAccountDto`'s type
definition — the global `whitelist`/`forbidNonWhitelisted` pipe
(decisions #10/#21) now rejects any request including them with 400,
same pattern as every prior DTO-spoofing fix in this project. Defense in
depth added at the repository layer too: the insert now hardcodes
`is_system_account = false`, `locked_at = null`, `locked_reason = null`
rather than reading them from the DTO even as a fallback — confirmed the
service method never read these fields in the first place, so this is
belt-and-suspenders, not a behavior change.

**Verification:** targeted suite (3 new cases: reject
`is_system_account`/`locked_at`/`locked_reason` → 400; accept without
them; repository defaults confirmed `false`/`null`) plus the broader
`dto-identity-whitelist` + `accounts.service.spec` suites — 3 suites / 68
tests passed. *(Decision #42)*

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

**This "backend is the only remaining safety net" principle is currently
violated on most routes — see the Known Open Items note at the top of
this document.** Identity/actor spoofing has been swept repeatedly
(§5.3, §5.6, #27), but *membership* — whether the authenticated user
belongs to the `company_id` being acted on at all — has only ever been
verified as a side effect of the post/approve/reject role checks. This
is being treated as this project's top-priority open item.

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

**Note:** this decision fixed *authentication* (is there a valid
session?), which is necessary but not sufficient — it does not verify
*membership* (does that session belong to the company being acted on?).
See the top-of-document note and §5.1's update.

### 5.7 `companies` table RLS — history

`companies` originally had no row-level security policy at all (§8's RLS
pattern covers every *other* multi-tenant table). It was safe only
because `service_role` — which bypasses RLS entirely — was the sole role
with grants on it (§5.1, §5.5): a **latent gap**, not an active one, but
one grant-configuration change away from a real cross-tenant leak.
Documented rather than fixed at the time it was found, since a real fix
needed a short design pass rather than a quick patch. *(Decision #25;
closed by decision #29, §5.10.)*

### 5.8 Journal-lines controller — residual auth-guard gap after #24

Decision #24 closed the broader unguarded-controller surface, but
`JournalLinesController` (`/journal-lines` POST create, PATCH `:id`) is a
separate Nest controller — registered in `JournalEntriesModule` alongside
`JournalEntriesController`, not a route inside it — and was **not**
included in that pass. It had no `SupabaseAuthGuard` at all, at either
the controller or route level.

**Audit outcome (same checklist as #21/#24):**
- Guard: missing → fixed with controller-level
  `@UseGuards(SupabaseAuthGuard)`.
- DTO identity: `CreateJournalLineDto` / `UpdateJournalLineDto` never
  accepted `created_by` / `updated_by` / actor fields — nothing to strip;
  global `whitelist` + `forbidNonWhitelisted` already rejects any spoofed
  field.
- Posted-line mutation → clean API error: **OK for update/delete** —
  `prevent_posted_line_mutation` raises `P0001`, mapped via
  `handleDatabaseError` to a `BadRequestException`. `createLine` remains
  a stub (`NotImplementedException`).

**Flagged, not fixed in this pass:** `prevent_posted_line_mutation` only
fires `BEFORE UPDATE OR DELETE` on `journal_lines` — it does **not** fire
on `INSERT`. A new line inserted directly onto an already-`posted`
journal entry is not currently blocked by that trigger. This is harmless
today only because `createLine` is stubbed; it becomes a live gap the
moment `createLine` is implemented without the trigger being extended
first. No schema change made in this decision — flagged for a dedicated
follow-up before `createLine` is built.

**Verification:** full suite 3x consecutive clean (16 suites / 136 tests)
on project `cuqnkorfhzydxwzkbjlv`. *(Decision #27)*

### 5.9 Posted-line INSERT immutability — trigger extension (#28)

Closed the gap §5.8 flagged. `trg_prevent_posted_line_update` fired only
on `UPDATE`/`DELETE` — a direct INSERT onto an already-`posted` parent
was not blocked. Closed **before** `createLine` is implemented, per §5.8's
recommendation.

**Schema change:** `prevent_posted_line_mutation()` itself is unchanged
(already uses `coalesce(new.journal_entry_id, old.journal_entry_id)`,
generic enough to cover INSERT with no rewrite). Trigger extended:
```sql
create trigger trg_prevent_posted_line_update
  before insert or update or delete on journal_lines
  for each row execute function prevent_posted_line_mutation();
```
Applied to both `schema.sql` and the live DB (`cuqnkorfhzydxwzkbjlv`);
confirmed matching via `pg_get_triggerdef` — Postgres normalizes the
event-list display order alphabetically (`INSERT OR DELETE OR UPDATE`),
which is cosmetic only, not a drift.

**Regression test:** direct PostgREST `journal_lines` insert (bypassing
the stubbed `createLine` endpoint) against a `posted` parent, in
`journal-entries.post.integration.spec.ts` — expects `P0001` with the
same message as the existing update/delete rejection.

**Incidental fix required:** several integration-test helpers seeded
`posted` journal entries via "insert entry as posted → then insert
lines" — a sequence the new trigger correctly makes illegal, since it
was always relying on the same loophole this decision closes. Rewritten
to the only valid sequence: create as `draft` → insert lines → post.

**Flagged, not fixed in this pass:** a transient `JWT issued at future`
auth error surfaced under parallel Jest workers during verification.
Worked around for this pass via auth-retry logic plus running the
verification suite with `--runInBand` (serial, not parallel) — this
avoids the symptom, it does not fix the underlying clock-skew/token-
issuance race. Normal parallel test runs may still intermittently hit
this. Needs its own investigation (likely a small allowed-clock-skew
tolerance on token issuance, or serializing auth-token acquisition in
test setup) — not addressed here to avoid scope creep on a trigger fix.

**Out of scope:** `createLine` implementation.

**Verification:** full suite 3x consecutive clean (16 suites / 137 tests
— 136 prior + the new INSERT-immutability regression test) on project
`cuqnkorfhzydxwzkbjlv`, run serially (`--runInBand`) per the JWT note
above. Live `pg_get_triggerdef` confirmed matching `schema.sql`.
*(Decision #28)*

**§5.9 update (2026-08-27) — root cause investigated; fix not yet
applied.** No new decision number; this updates the open item rather
than closing it.

Reproduced under parallel Jest (`--maxWorkers=50%`):
`companies.rls.integration.spec.ts`'s `beforeAll` failed all 3 tests with
`JWT issued at future` (~8s suite abort). The flake is genuinely
intermittent — 12 consecutive full parallel runs in the same session
passed clean (20 suites / 206 tests each). A standalone 96-job concurrent
admin+insert stress test did not reproduce it in isolation.

**Ruled out:** cross-worker token caching/reuse (each worker creates its
own client, no shared session), and `withAuthRetry` itself introducing
the race (it only retries — it doesn't mint or share tokens). Local
clock was ~+0.7s ahead of a reference time source and Windows Time
service was found stopped, but sampled `iat` values on real access
tokens were within 0–1s of local time — not consistent with a
meaningful local NTP-drift explanation.

**Root cause:** this project's `SUPABASE_SECRET_KEY` is an opaque
`sb_secret_…` key, not a legacy `service_role` JWT. Supabase's hosted API
Gateway verifies that opaque key and mints a short-lived JWT (`iat ≈
now`) per request, forwarded to GoTrue/PostgREST for validation. When the
gateway's issuing clock is briefly ahead of the validating service's
clock, the request is rejected with the classic `PGRST303`/"JWT issued
at future" error. Parallel Jest workers raise concurrent token-minting
volume across edge nodes, which matches the parallel-only, intermittent
nature of the symptom. This is a gateway-vs-validator clock relationship,
not a client-side (laptop) clock problem.

One related, previously-unflagged detail: `ensureAuthUser`'s retry logic
only wraps Auth Admin calls. `companies.insert` / `company_members.upsert`
(PostgREST, same `sb_secret` key path) are not retried — so a gateway-skew
failure on those specific calls isn't covered by the existing workaround
even though Auth Admin is.

**Recommended fix, not yet applied (pick one, needs a decision):**
1. *Preferred* — switch the backend/test `SUPABASE_SECRET_KEY` to the
   legacy `service_role` JWT (Dashboard → API Keys → Legacy), which has
   an `iat` far in the past and so never enters the short-lived
   gateway-minted-token path. Requires adding that legacy key to
   `.env.local`, which isn't present today.
2. *Fallback, workaround only* — broaden `withAuthRetry` to also wrap
   the untested PostgREST setup writes (`companies` insert,
   `company_members` upsert), not just Auth Admin. Reduces the failure
   window without addressing the underlying cause.
3. *Hygiene, not sufficient alone* — start the Windows Time service /
   enable automatic NTP sync. Helps client-side auth correctness in
   general but does not touch the gateway↔validator skew that's the
   actual cause here.

**Status: closed by decision #37.** See below.

**§5.9 closure (2026-08-27, decision #37).** Fixed with a shared
fetch-level retry wrapper on `SupabaseService`'s `global.fetch` — the
single client constructed with `SUPABASE_SECRET_KEY` — rather than a
per-call-site patch or a switch to the legacy `service_role` JWT
(explicitly rejected: that key type is on Supabase's own deprecation
path, and depending on it would trade this flagged issue for a future
one).

Because the wrapper sits at the client's `fetch` level rather than
wrapping individual calls, Auth Admin, PostgREST, and any future call
made through this client are covered automatically — not just the
specific calls known to fail today. `ensureAuthUser`'s bespoke retry
logic (the original #28 workaround) was removed as redundant once this
wrapper existed, so there's now exactly one retry implementation, not
two doing the same job.

**Match criteria (narrow, by design):** only `/JWT issued at future/i`
or a PostgREST `code === 'PGRST303'` response — nothing else retries.
This was a deliberate constraint so the wrapper can't mask unrelated
bugs by silently retrying arbitrary failures.

**Backoff:** 5 attempts, `250ms * attempt` — reused from the removed
`ensureAuthUser` helper's existing parameters rather than inventing new
timing.

**Verification — the actual proof this is fixed, not just re-hidden:**
full suite run 3x consecutive **without** `--runInBand` (genuine parallel
workers, the condition that originally triggered the flake):

| Run | Result | Wall |
|---|---|---|
| 1 | 21 suites / 212 tests | ~113s |
| 2 | 21 suites / 212 tests | ~106s |
| 3 | 21 suites / 212 tests | ~104s |

`--runInBand` is no longer required for this project's tests. Combined
with #33's batch-insert fix, full-suite wall-clock time has gone from
the original ~953s baseline to ~105s — roughly a 9x improvement.
*(Decision #37)*

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

`private.is_company_member()` is `SECURITY DEFINER` specifically so the
membership check itself isn't blocked by `company_isolation_members` (the
existing RLS policy on `company_members`, left unchanged) — without this,
the policy would need to read a table it doesn't have permission to read
in order to decide permission, which doesn't resolve. Grant is
**SELECT-only** to `authenticated`; `anon` remains fully ungated; all
writes and every other table remain `service_role`-only per §5.1/§5.5 —
this policy protects a hypothetical future state (if `anon`/`authenticated`
ever get broader table access), not current backend behavior, since the
Nest backend always queries as `service_role` and bypasses RLS entirely
today.

**Security Advisor hardening (decision #40):** the helper lives in schema
`private` (not PostgREST-exposed), so it cannot be called via
`/rest/v1/rpc/is_company_member`. `EXECUTE` is granted to `authenticated`
(required for RLS evaluation) and `service_role`; **revoked from `anon`**.
`btree_gist` (and other extensions) install into schema `extensions`, not
`public` (lint 0014). `schema.sql` also **drops** any leftover
`public.is_company_member` and **relocates** `btree_gist` out of `public`
before `CREATE EXTENSION IF NOT EXISTS` — that statement is a no-op when
the extension already exists in another schema, which is why a schema-only
apply could still leave Advisor warnings until
`apply_security_advisor_lints.sql` ran.

**Live apply:** required via Supabase SQL Editor (no automated migration
runner in this project, consistent with #28's precedent) —
`docs/source-of-truth/apply_companies_rls.sql` for the original #29
policy; if Advisor still reports 0014/0028/0029 after an older apply, run
`docs/source-of-truth/apply_security_advisor_lints.sql`. Current
`schema.sql` §11/§12 already match #40.

**Note — decision #40's RLS policy alone did NOT close Nest membership
enforcement.** That gap is closed by decision #41 (§5.11): Nest routes
now verify `company_members` before every tenant-scoped handler.
Companies RLS (#29/#40) and Nest membership (#41) are complementary —
RLS for direct Data API access; #41 for `service_role` backend routes.

**Regression test:** `companies.rls.integration.spec.ts` — real JWTs, not
service_role: `anon` → `42501`; `authenticated` → sees only their member
company, not others; `service_role` → sees both (baseline behavior,
unaffected).

**Verification:** baseline 16 suites / 137 tests clean → post-apply 3x
consecutive clean, **17 suites / 140 tests** (`--runInBand`), on project
`cuqnkorfhzydxwzkbjlv`. Backend Nest paths confirmed unchanged.
*(Decision #29)*

### 5.11 Nest company-membership enforcement on every tenant route (#41)

**Problem.** §5.1 makes the Nest backend (running as `service_role`,
bypassing RLS) the only tenant-isolation safety net. Until #41,
membership was verified only on journal post/approve/reject — as a side
effect of `JournalEntryCompanyRoleGuard` / `resolveRoleForJournalEntry`.
Every other route trusted a caller-supplied `company_id` (body/query) or
a parent resource id without confirming the authenticated user belonged
to that company. That was a real cross-tenant access gap (gap-audit
§7.16 finding #1).

**Mechanism.** One shared guard, not per-route patches:

- `@RequireCompanyMembership({ type, … })` metadata on every HTTP handler
- `CompanyMembershipGuard` (after `SupabaseAuthGuard`) resolves
  `company_id` then calls `CompanyMembersService.resolveRole` — **403**
  when the user is not a member (never 404 for non-membership)
- Resolution shapes:
  - `body` / `query` — direct `company_id`
  - `param` + resource — account, accounting_period, journal_entry,
    journal_line, recurring_template, recurring_template_line
  - `body_ref` — e.g. `journal_entry_id` on `POST /journal-lines`
- Fail-closed: missing metadata → 500 (completeness test asserts every
  handler declares the decorator)
- Attaches `request.user.role` so post/approve/reject **reuse** the
  resolved role (no second `company_members` lookup). Legacy
  `JournalEntryCompanyRoleGuard` removed.

**API tightening required by the gate:**

- `GET /accounts` and `GET /recurring-journal-templates` now **require**
  `company_id` (same bar as periods/journals)
- `POST /recurring-journal-templates/run-due` requires body `company_id`
  and only generates for that company (no cross-tenant batch)

**Routes covered (all handlers on these controllers):**
accounts (6), accounting-periods (5), journal-entries (11),
journal-lines (3), recurring-journal-templates (8),
recurring-journal-template-lines (2), audit-log (1).

**Tests:** `company-membership.guard.integration.spec.ts` — reflector
completeness + live JWT non-member **403** on every shape + member
success; `controller-auth-coverage.spec.ts` updated for the new guard.

**Out of scope for #41:** audit findings #2–#8 (separate prompts).
*(Decision #41)*

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

### 7.2 Journal-lines controller auth audit — status

**Closed 2026-08-25.** Same-day follow-up to §7.1: `JournalLinesController`
was found to have no `SupabaseAuthGuard` coverage at all, missed by
decision #24's pass because it's a separate controller from
`JournalEntriesController`. Fixed with the identical controller-level
guard pattern as #21/#24. Full suite (16 suites / 136 tests — 128 prior +
new auth/whitelist coverage for `/journal-lines`) run 3x consecutive
clean against `cuqnkorfhzydxwzkbjlv`. See §5.8 for the full audit
breakdown and the flagged (not yet fixed) `prevent_posted_line_mutation`
INSERT gap. *(Decision #27)*

### 7.3 Posted-line INSERT trigger gap — status

**Closed 2026-08-25.** Same-day follow-up to §7.2: the
`prevent_posted_line_mutation` INSERT gap flagged in §5.8 is fixed —
trigger extended to `BEFORE INSERT OR UPDATE OR DELETE`, applied to both
`schema.sql` and the live DB, confirmed matching via `pg_get_triggerdef`.
Full suite (16 suites / 137 tests — 136 prior + new INSERT-immutability
regression test) run 3x consecutive clean, serially (`--runInBand`) to
avoid a separately-flagged transient JWT clock-skew issue under parallel
workers (see §5.9 — that issue itself remains open). *(Decision #28)*

### 7.4 `companies` RLS gap — status

**Closed 2026-08-25.** The latent gap documented in §5.7/decision #25 —
`companies` had no RLS policy at all — is fixed via
`company_isolation_companies` (§5.10). Verified with real (non-
service_role) JWTs: `anon` rejected with `42501`, `authenticated` scoped
to member companies only, `service_role` unaffected. Full suite (17
suites / 140 tests — 137 prior + new `companies.rls.integration.spec.ts`)
run 3x consecutive clean, serially, on `cuqnkorfhzydxwzkbjlv`.
*(Decision #29)*

### 7.5 Accounting periods CRUD — status

**Closed 2026-08-25.** Create/list/update implemented for
`AccountingPeriodsController` against the actual `accounting_periods`
schema (no invented columns) — see §4.5 for full behavior, including the
flagged (not fixed) concurrent-overlap race. App-layer change only, no
live-DB apply needed. Full suite (18 suites / 164 tests) run 3x
consecutive clean, serially, on `cuqnkorfhzydxwzkbjlv`. *(Decision #30)*

### 7.6 Journal entries list + header update — status

**Closed 2026-08-26.** List and draft-only header update implemented for
`JournalEntriesController` against the actual `journal_entries` schema —
see §4.6 for full behavior, including the flagged (not fixed) gap that no
DB trigger blocks UPDATE of a posted header (mirrors §4.5's period-overlap
flag). `createLine` remains untouched/out of scope. Full suite (19 suites
/ 180 tests) run 3x consecutive clean, serially, on `cuqnkorfhzydxwzkbjlv`.
*(Decision #31)*

### 7.7 Journal line create (`createLine`) — status

**Closed 2026-08-26.** `POST /journal-lines` implemented against the
actual `journal_lines` schema (debit/credit XOR check, unique
`journal_entry_id`+`line_number`) — see §4.7 for full behavior,
including two flagged-not-fixed items: no same-company/active-account
validation on `account_id` (matches an existing identical gap in
`insert_journal_entry_draft`), and no `deleteLine` route despite
service/repo support existing. Confirmed the #28 posted-line INSERT
trigger fires correctly through this endpoint specifically, not only via
#28's original raw-insert regression test. Full suite (19 suites / 186
tests) run 3x consecutive clean, serially, on `cuqnkorfhzydxwzkbjlv`.
*(Decision #32)*

### 7.8 COA-clone batch insert — test-setup performance (#33)

**Closed 2026-08-26.** Pure performance fix, no product or test-behavior
change. `ensureCompanyWithCoa` (`src/e2e/e2e-company.setup.ts`) inserted
the ~183-account demo COA one row per PostgREST call (~183 sequential
round-trips, ~53s per mint) — used by 8 suites' shared `beforeAll` minting
plus advisory-lock's 7 per-test mints, 15 mints total in a full run,
accounting for roughly 13 of the prior ~16-minute total wall-clock time.

Replaced with a single batched `.insert([...])` of all 183 rows,
pre-assigned UUIDs so `parent_account_id` resolves correctly and the same
depth/`account_number` insertion order is preserved for
`trg_enforce_account_hierarchy_depth`. 183 rows is well under PostgREST's
practical per-call batch guidance (~500–1000), so no chunking was needed.
No change to COA content, calling suites, `--runInBand`, the JWT retry
logic (§5.9), or advisory-lock's actual concurrency-load test bodies —
only its setup got faster.

**Measured:** full-suite wall-clock **297s / 290s / 276s** across 3x
consecutive `--runInBand` runs (down from the ~953s single-run baseline
measured pre-fix), per-mint account insert **~549ms** (down from ~53s).
All three runs: 19 suites / 180 tests clean on `cuqnkorfhzydxwzkbjlv`.
*(Decision #33)*

### 7.9 Journal line delete — status

**Closed 2026-08-27.** `DELETE /journal-lines/:id` implemented, wired to
the pre-existing `deleteLine` service method — see §4.8. Confirmed the
#28 posted-line trigger correctly blocks deletion of a line on a posted
parent through this route specifically. Full suite (19 suites / 190
tests) run 3x consecutive clean, serially, on `cuqnkorfhzydxwzkbjlv`.
*(Decision #34)*

### 7.10 Journal line `account_id` validation — status

**Closed 2026-08-27.** Same-company + active-account checks added for
both `createLine` and `insert_journal_entry_draft` via one shared
helper — see §4.9, including the two remaining flagged call sites
(`create_opening_balance_entry`, `updateLine`). Full suite (20 suites /
196 tests) run 3x consecutive clean, serially, on `cuqnkorfhzydxwzkbjlv`.
*(Decision #35)*

### 7.11 Accounts update — status

**Closed 2026-08-27.** `PATCH /accounts/:id` implemented with a
purpose-built whitelist DTO (metadata fields only) — see §4.10 for the
full editable/non-editable column breakdown, and the flagged gap that
system-account UPDATE protection is service-layer only (no DB trigger,
unlike the DELETE-only `trg_prevent_account_deletion`). Full suite (20
suites / 206 tests) run 3x consecutive clean, serially, on
`cuqnkorfhzydxwzkbjlv` (~284–292s per run). *(Decision #36)*

### 7.12 JWT clock-skew — closed

**Closed 2026-08-27.** Root-caused in the §5.9 update earlier this same
day, fixed same day: a shared fetch-level retry wrapper on
`SupabaseService`'s secret-key client, narrowly matching only
`PGRST303`/"JWT issued at future" — see §5.9's closure note for full
detail. `ensureAuthUser`'s old bespoke retry was removed as redundant.
**`--runInBand` is no longer required.** Verified with 3x consecutive
clean full-suite runs in genuine parallel mode (21 suites / 212 tests,
~104–113s each) — down from the ~953s single-run baseline this whole
investigation started from (roughly 9x faster, combined with #33).
*(Decision #37)*

### 7.13 DB-level defense-in-depth: period overlap + posted-header immutability — status

**Closed 2026-08-27.** Both remaining service-layer-only gaps from §4.5
(#30) and §4.6 (#31) now have a DB backstop — see §4.11 for full detail:
a `btree_gist` exclusion constraint on `accounting_periods` and a new
`trg_prevent_nondraft_header_mutation` trigger on `journal_entries`.
Both confirmed live (exclusion returns `23P01` on overlap;
`pg_get_triggerdef` matches `schema.sql`). Full suite (21 suites / 216
tests) run 3x consecutive clean, in genuine parallel mode, on
`cuqnkorfhzydxwzkbjlv` (~115–122s per run). *(Decision #38)*

### 7.14 Remaining `account_id` validation gaps — status

**Closed 2026-08-27.** `create_opening_balance_entry` and `updateLine`
(when changing `account_id`) now reuse `assertAccountsUsableForCompany`
unchanged — see §4.9's closure note. This was the last of §4.9's
*originally* flagged call sites (a later, separate audit found a fifth
site — see the Known Open Items note at the top of this document). Full
suite (21 suites / 218 tests) run 3x consecutive clean, in genuine
parallel mode, on `cuqnkorfhzydxwzkbjlv` (~113–119s per run).
*(Decision #39)*

### 7.15 Security Advisor lints (extension_in_public / SECURITY DEFINER RPC) — status

**Closed 2026-08-27.** Supabase Security Advisor WARN on fresh apply:
`btree_gist` in `public` (0014), and `public.is_company_member` executable
by `anon`/`authenticated` as SECURITY DEFINER via PostgREST RPC
(0028/0029). Fix: extensions install into schema `extensions`; membership
helper moved to `private.is_company_member` (not API-exposed); EXECUTE
revoked from `anon`, kept for `authenticated` + `service_role` so #29 RLS
still evaluates. `schema.sql` also relocates a public `btree_gist` and
drops leftover `public.is_company_member` (IF NOT EXISTS / CREATE OR
REPLACE cannot move objects across schemas). Live one-shot for older DBs:
`docs/source-of-truth/apply_security_advisor_lints.sql`. Fresh project
`hilaeuvltstgedlpgjcw` verified 3x consecutive clean in parallel mode
(21 suites / 218 tests). See §5.10. *(Decision #40)*

**Note:** this decision addressed Supabase Security Advisor lints
(schema hygiene for extensions and a specific RPC's exposure surface) —
it is unrelated to, and does not address, the company-membership
enforcement gap described at the top of this document. Do not treat #40
as having closed that item.

### 7.16 Comprehensive gap audit — 8 new findings, 1 critical

**2026-08-27, no code changed — reporting only.** A systematic sweep
across auth-guard coverage, identity/actor-field spoofing,
service-layer-only enforcement, cross-call-site validation consistency,
missing routes, RLS coverage, grant hygiene, and trigger completeness —
the same categories decisions #21–#40 had each individually addressed —
found 8 new findings not previously in this document, ranked by risk:

| Rank | Risk | Finding | Status |
|---|---|---|---|
| 1 | **Security — critical** | Company membership not verified on Nest routes except post/approve/reject | **Closed by decision #41 (§5.11)** |
| 2 | Security | `CreateAccountDto` accepts `is_system_account`, `locked_at`, `locked_reason` from the client | **Closed by decision #42 (§4.12)** |
| 3 | Security | `UpdateRecurringJournalTemplateDto` can reassign `company_id` via `PartialType` | Open |
| 4 | Integrity | Recurring-template line inserts skip `assertAccountsUsableForCompany` (5th call site, §4.9) | Open |
| 5 | Integrity | `accounts.parent_account_id` not validated as same-company | Open |
| 6 | Integrity | `trg_enforce_journal_balance_on_post` is UPDATE-only — INSERT as `posted` bypasses it | Open |
| 7 | Hygiene | Trigger helper functions lack §5.1 EXECUTE-revoke checklist | Open |
| 8 | Completeness | `getAccountTrialBalance` has a service method but no HTTP route | Open |

**Already confirmed solid by this same audit (0 new findings):** all 7
controllers have auth guards; all 11 tables + the trial-balance view have
correct RLS coverage; classic `*_by` identity-spoofing fields are clean
everywhere; `deleteLine` is routed (#34).

Findings 1–2 closed (#41, #42). Findings 3–8 remain queued.

### 7.17 Nest company-membership enforcement — status

**Closed 2026-08-27.** Shared `CompanyMembershipGuard` +
`@RequireCompanyMembership` on every tenant-scoped handler; post/approve/
reject reuse guard-resolved role (no duplicate lookup). See §5.11.
Verified: completeness reflector test + non-member 403 on all route
shapes + member success; full suite 3x consecutive clean in parallel mode
on `hilaeuvltstgedlpgjcw`. *(Decision #41)*

### 7.18 `CreateAccountDto` system-field lockdown — status

**Closed 2026-08-27.** §7.16 finding #2. `is_system_account`, `locked_at`,
`locked_reason` removed from `CreateAccountDto`; repository insert
hardcodes system defaults rather than reading them even as a fallback.
Verified: 3 targeted cases (reject all three fields with 400; accept
without them; confirm repository defaults) plus `dto-identity-whitelist` +
`accounts.service.spec` — 3 suites / 68 tests passed. See §4.12.
*(Decision #42)*

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
| 27 | 2026-08-25 | `JournalLinesController` had no auth guard after #24 — fixed with controller-level `SupabaseAuthGuard` (same pattern as #21); no identity-field DTO changes needed; `prevent_posted_line_mutation` INSERT gap flagged, not fixed | §5.8, §7.2 |
| 28 | 2026-08-25 | `prevent_posted_line_mutation` extended to fire on INSERT, closing the gap #27 flagged; applied to `schema.sql` and live DB, confirmed matching; test helpers relying on the now-illegal "insert as posted" sequence rewritten to draft→lines→post; transient parallel-worker JWT clock-skew issue found and flagged (not fixed) | §5.9, §7.3 |
| 29 | 2026-08-25 | `companies` had no RLS at all (#25) — closed with membership-based `company_isolation_companies` policy via `company_members`/`auth.uid()`, SELECT-only grant to `authenticated`; verified with real anon/authenticated/service_role JWTs; backend paths unchanged | §5.10, §7.4 |
| 30 | 2026-08-25 | Accounting-periods create/list/update implemented against actual schema (no period label/number column exists); overlap + posted-activity checks are service-layer only (no DB exclusion constraint), flagged as a low-priority concurrent-write race; soft-close remains the only status-transition path; app-layer only, no live-DB apply | §4.5, §7.5 |
| 31 | 2026-08-26 | Journal-entries list + draft header PATCH; required `company_id` query (+ optional status/period_id); header fields only while draft; no status/identity side door; schema has no posted-header UPDATE trigger (flagged, not fixed); `createLine` still out of scope | §4.6, §7.6 |
| 32 | 2026-08-26 | `createLine` (`POST /journal-lines`) implemented; debit/credit XOR + posted-parent rejection enforced via existing constraints/#28 trigger, surfaced cleanly; no same-company/active-account check on `account_id` (flagged, matches existing gap in `insert_journal_entry_draft`); `deleteLine` has service/repo support but no route (flagged, not built) | §4.7 |
| 33 | 2026-08-26 | Test-setup only: `ensureCompanyWithCoa` COA clone changed from per-row inserts to one batched insert (~183 accounts); no product/behavior change; full-suite wall ~953s → ~276–297s (3x clean), per-mint insert ~53s → ~0.55s | §7.8 |
| 34 | 2026-08-27 | `DELETE /journal-lines/:id` wired to existing `deleteLine` method; posted-parent DELETE blocked by #28 trigger as 400; closes the route gap #32 flagged | §4.8, §7.9 |
| 35 | 2026-08-27 | Shared same-company + `is_active` validation added for `createLine` and `insert_journal_entry_draft` account_id; `create_opening_balance_entry` and `updateLine` account_id left flagged, not in scope; FK unchanged | §4.9, §7.10 |
| 36 | 2026-08-27 | `PATCH /accounts/:id` implemented — metadata fields only (`account_name`, `sub_category`, `description`); structural/identity/hierarchy fields rejected by DTO; system-account UPDATE protection is service-layer only, no DB trigger (flagged) | §4.10, §7.11 |
| 37 | 2026-08-27 | Closed §5.9 JWT clock-skew via a shared fetch-level retry wrapper on `SupabaseService`'s secret-key client (matches only `PGRST303`/"JWT issued at future"; 5 attempts, `250ms*attempt`); no legacy `service_role` key swap; `ensureAuthUser`'s old retry removed as redundant; `--runInBand` no longer required — verified in genuine parallel mode, ~953s baseline → ~105s | §5.9, §7.12 |
| 38 | 2026-08-27 | DB-level defense-in-depth added for the two remaining service-layer-only gaps: `accounting_periods_company_daterange_excl` (btree_gist exclusion constraint, closes #30's period-overlap flag) and `trg_prevent_nondraft_header_mutation` (BEFORE UPDATE trigger, closes #31's posted-header flag); both confirmed live; existing service-layer checks retained; verified in parallel mode | §4.11, §7.13 |
| 39 | 2026-08-27 | Closed §4.9's *originally flagged* call sites: `create_opening_balance_entry` and `updateLine` (when `account_id` changes) now reuse `assertAccountsUsableForCompany` unchanged; same 400 shape as #35; `createLine`/draft-insert untouched. **Note:** a later audit found a 5th call site (recurring-template lines) not covered here — see §7.16 finding #4 | §4.9, §7.14 |
| 40 | 2026-08-27 | Security Advisor: move `btree_gist` (and other extensions) to schema `extensions`; move `is_company_member` to `private` (drop public RPC surface); revoke EXECUTE from `anon`. **Unrelated to the membership-enforcement gap found in the same day's later audit (§7.16) — does not close it.** | §5.10, §7.15 |
| 41 | 2026-08-27 | Closed Nest cross-tenant membership gap (audit §7.16 finding #1): shared CompanyMembershipGuard + @RequireCompanyMembership on every tenant-scoped route; post/approve/reject reuse guard-resolved role (no duplicate lookup); accounts/recurring list + run-due require company_id; 403 for non-members | §5.11, §7.17 |
| 42 | 2026-08-27 | Closed §7.16 finding #2: `CreateAccountDto` no longer accepts `is_system_account`/`locked_at`/`locked_reason` from the client; repository insert hardcodes system defaults as defense in depth | §4.12, §7.18 |