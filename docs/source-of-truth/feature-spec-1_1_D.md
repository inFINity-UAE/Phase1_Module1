# Module 1.1.D — Accounts Receivable Management
## Feature Specification (Source of Truth)

Part of Module 1.1 · AI-Based Accounting Foundation, inFINity Phase 1 (MVP).
This is the authoritative scope document for Module 1.1.D only — do not
infer scope from Module 1.1.A/C/H1 or other 1.1.B–H modules.

**Status: scoped and decision-logged, not yet built.** §2 below is a
ratified decision log (D-1…D-9), grounded against `schema.sql`, the
finalized `Chart_of_Accounts_-_inFINity.xlsx`, and — for D-8 — explicit
accountant sign-off, matching the discipline `feature-spec.md` (A) and
`feature-spec-1_1_C.md` (C) use. **D-8's answer expands scope beyond the
original 8 deliverables**: monthly ECL provisioning (§4.5) is new work,
not a different journal entry on an existing feature — flagged here so
it isn't buried in a decision-log entry. It is still a *pre-build*
document otherwise: no code exists for D yet, so nothing here claims to
have been tested. As build proceeds, any decision that turns out to need
revision gets a new numbered entry appended (D-10+) rather than silently
edited — same rule A's and C's logs follow.

**Dependencies, verified directly against `schema.sql`:** Module 0 (A) —
`companies`, `accounts`, `journal_entries`, `journal_lines`,
`is_ledger_truth_status()`, the advisory-lock convention — is complete.
Module 2 (C) — `customers`, `invoices`, `invoice_lines`, `credit_notes`,
`credit_note_lines` — is complete. Confirmed in-schema (not inferred):

- `invoices.status` (`invoice_status` enum, line ~1128) already includes
  `partially_paid`, `paid`, `overdue`, **and `written_off`** — all four
  reserved, none wired to a transition yet.
- Line 1912–1914, on `mark_overdue_invoices()`, is an explicit handoff
  comment already in the schema: *"Pure status flip on due_date only —
  does not read or update amount_paid (§10; Module D owns payment
  application)."* D's job is exactly that handoff.
- `1100` = Accounts Receivable - Trade (used directly in
  `post_invoice_to_ledger`, confirmed by code, not by name lookup).
- `2200` = VAT output, `4060` = sales-discount contra-income, `3100` =
  Retained Earnings — the only other account numbers hardcoded anywhere
  in `schema.sql`.
- No `payments`, `payment_applications`, `advances`, or `write_offs`
  table exists yet — D is fully greenfield on schema.

**Confirmed directly against `Chart_of_Accounts_-_inFINity.xlsx`** (the
real, finalized 179-account COA, not a sample): `1020` Bank Account -
Current (AED), `2060` Customer Advances / Deposits Received, `5640` Bad
Debt Expense (ECL), `1110` Allowance for Expected Credit Losses. Notably,
`5640`'s own Notes field reads *"IFRS 9 — offsets 1110 allowance"* —
the COA was built expecting the allowance method, which is the substance
of D-8 below.

---

## 1. Scope boundary

Source deliverables for this pass, each mapped to a section below:

| # | Deliverable | Section |
|---|---|---|
| 1 | Customer ledger — full transaction history, running balance | §5.1 |
| 2 | Aged receivables report — 0–30/31–60/61–90/90+ buckets + totals | §5.2 |
| 3 | Customer credit limit — alert when a new invoice would exceed it | §5.3 |
| 4 | Customer statement of account — one-click PDF | §5.4 |
| 5 | Payment receipt — full/partial, against one or multiple invoices | §4.2 |
| 6 | Advance receipt — deposits before invoicing, applied later | §4.3 |
| 7 | Write-off — bad debt write-off, allowance method (§4.4, §4.5) | §4.4 |
| 8 | Customer payment history — average actual days to pay vs. terms | §5.5 |

**Explicitly out of scope for this pass** (see §7 for detail): the actual
VAT-201 return filing/reclaim mechanics (Module F owns the filing itself
— D computes and flags eligibility per D-8, F applies it on the return);
PDF/XLSX/CSV export mechanics generally (Build Order §8, H-remainder);
automated dunning/reminder delivery; multi-currency; partial reversal of
a write-off beyond A's standard reversal mechanism.

**Depends on:** Module 0 (A — ledger engine, accounts, journal posting),
Module 2 (C — customers, invoices, credit notes).

---

## 2. Decision log

Numbered, ratified, mirrors A/C's format. Each entry states the decision
and the schema evidence it rests on, not just the reasoning.

### D-1 — One `payments` table for both payments and advances

**Decision:** a single `payments` header table. A row with zero
`payment_applications` children *is* an advance; the same row gains
applications later as it's applied to invoices. No separate `advances`
table.

**Why:** structurally the same event (cash received from a customer) at
different points in its application lifecycle. Two tables would mean
migrating a row from one table to another the moment an advance gets
applied — an awkward, stateful move C never needed for its own single
`invoice_type` enum. This decision is load-bearing for D-3 (it's *why*
the credit account differs by application-state, not by which table a
row lives in).

### D-2 — GL accounts: resolved against the real COA, not invented

**Decision:** account numbers below are read directly from
`Chart_of_Accounts_-_inFINity.xlsx`, the same discipline C's intro used
for every account-numbering call.

| Purpose | Account | Basis |
|---|---|---|
| Accounts Receivable | `1100` | Confirmed in `post_invoice_to_ledger`, schema.sql line ~1545-1548 |
| Bank/Cash default | `1020` | D-6 |
| Customer Advances liability | `2060` | D-7 |
| Bad Debt Expense | `5640` | D-8 — ratified, allowance method |
| ECL Allowance (contra-AR) | `1110` | D-8 — ratified, allowance method |

`2050`/`1120` (Retainer Liability / Retainer Balances Held) were
considered for the advances account and deliberately **not** used — see
D-7.

### D-3 — `invoices.paid_at`: new column, set once

**Decision:** add `invoices.paid_at timestamptz`, nullable, set exactly
once — the moment a `payment_applications` insert pushes
`amount_paid = grand_total` and status flips to `paid`.

**Why:** DSO (§5.5) needs "the date this invoice became fully paid,"
which for an invoice paid across several partial payments is not any
single payment's own date and isn't cheaply re-derivable per report call.
A schema change, flagged explicitly as such — same treatment A's spec
gives any new column, not folded in quietly.

### D-4 — Credit limit: alert-only, non-blocking

**Decision:** the invoice-Issue endpoint returns the credit-limit alert
in its response but does not reject the request. No override/authorization
workflow is designed for it.

**Why:** the deliverable's own wording is "alert," not "block." A hard
stop would require an override workflow (who can bypass, under what
approval — A's Owner-bypass pattern exists for a *reason*, and credit
limits weren't it) that nothing in the deliverables asked for. If a hard
block is wanted later, that's a new, explicit decision (D-6+), not a
retrofit onto this one.

### D-5 — Aging buckets: explicit `current` bucket, not folded into 0–30

**Decision:** `get_aged_receivables` returns a `current` bucket (not yet
past `due_date`) alongside the four named overdue buckets, all keyed off
`as_of_date − due_date`: `≤0` → current, `1–30`/`31–60`/`61–90`/`90+` →
the requested buckets.

**Why:** collapsing not-yet-due invoices into "0–30 overdue" misstates a
customer's actual risk on the report — standard aged-receivables
convention, and the FTA/UAE-audit context this system targets, expects
Current shown separately.

### D-6 — Default bank account: `company_settings.default_bank_account_id`, `1020` seeded default

**Decision:** add `default_bank_account_id` to `company_settings`
(same shape as the existing `journal_approval_threshold` — a
company-level default, not hardcoded in application code), defaulting to
account `1020` (Bank Account - Current AED). `payments` also gets an
optional `bank_account_id` override for the less common case of a
specific payment landing in a different account.

**Why:** `payments` (§3.2) had no way to select an account at all in the
original draft — every payment would have posted against an unspecified
"Bank/Cash," which isn't postable. `1020` is the only default-active,
AED-denominated current account in the COA, matching what an MVP-stage
UAE SME would actually use day to day.

### D-7 — Customer advances liability: `2060`, not `2050`

**Decision:** advance receipts post to `2060` Customer Advances /
Deposits Received.

**Why:** the deliverable's own wording — "customer deposits before
invoice raised" — is `2060`'s exact description in the COA. `2050`
Retainer Liability, paired with `1120` Retainer Balances Held (Customer
Advances Applied), reads as a distinct professional-services retainer
concept (funds drawn down against specific matters over time) that none
of D's eight deliverables describe. Leaving `2050`/`1120` untouched
rather than repurposing them for a use case they weren't named for.

### D-8 — Bad-debt posting model: **ratified — allowance (ECL) method**, per accountant sign-off

**Decision:** Option B (allowance method), confirmed by the entity's
accountant. Two distinct GL flows:

1. **Monthly ECL provisioning** (§4.5, new scope — not one of D's
   original 8 deliverables): a scheduled top-up/release entry,
   `Dr`/`Cr` `5640` against `1110`, sized to the gap between the
   required allowance (aging-bucket loss rates × outstanding balances,
   with per-customer manual overrides) and the current `1110` balance.
2. **Write-off** (§4.4, revised): `Dr 1110`, `Cr 1100` — draws down the
   allowance already provisioned; no further P&L impact at the point a
   specific invoice is actually written off.

**Loss-rate methodology, per accountant:** default rate keyed to the
same aging buckets as D-5 (`current`/`0-30`/`31-60`/`61-90`/`90+`), with
manual per-customer override for specific known risk (e.g. a customer in
litigation). Reviewed monthly as part of month-end close; the rates
themselves reassessed at least yearly against actual write-off history.

**VAT relief timing, per accountant:** deliberately decoupled from the
write-off decision — write-off happens whenever collectability is
judged, independent of the FTA's 6-month clock. Once an invoice is both
written off **and** more than 6 months past its date of supply
(`invoices.invoice_date`, not the write-off date), and the debtor has
been notified in writing (a separate, explicit FTA condition the
accountant flagged as easy to miss), the invoice is flagged eligible for
VAT reclaim on the next return. D computes and flags eligibility; F still
owns the actual VAT-201 filing, per Build Order §3 — that split is
unchanged, only *what* D hands off is now precise.

**Approval, per accountant:** write-offs reuse A's existing
threshold-based journal-entry approval (`company_settings.
journal_approval_threshold`) rather than a bespoke workflow — this falls
out for free once a write-off posts through the normal `journal_entries`
path (see D-9/§4.4), including the schema's existing self-approval
logging (schema.sql line ~582-610: *"Self-approved by Owner"* audit-log
note when `approved_by = created_by`). Monthly provisioning entries get
a lighter, non-blocking review instead (§4.5) — a statistical estimate,
not a discretionary write-off judgment, so it doesn't need the same
gate.

### D-9 — Write-off endpoint: extend C's existing route, don't duplicate it

**Decision:** `POST /invoices/:id/write-off` already exists from C
(status-only transition — confirmed in `feature-spec-1_1_C.md` line 394:
*"C1-3 exposes status transition only... bad-debt journal... [is]
Module D"*). D extends that same route to also create the `write_offs`
row and post the GL entry (§4.4), rather than adding a second,
parallel endpoint.

**Why:** two ways to write off the same invoice is a real defect
surface — C's stub already owns the URL and the auth/validation around
"can this invoice be written off," D only needs to add what happens
*after* that check passes.

---

## 3. Schema additions

Building on C's `customers` / `invoices` / `credit_notes`, following the
same column-naming and constraint conventions used throughout
`schema.sql` (uuid PKs via `gen_random_uuid()`, `company_id` FK on every
tenant-scoped table, `created_at`/`updated_at timestamptz not null default
now()`).

### 3.1 `customers` (extend)

- `credit_limit numeric(18,2)` — nullable; `null` = no limit enforced.

### 3.1a `company_settings` (extend) — per D-6

- `default_bank_account_id uuid references accounts(id)` — seeded to
  account `1020` (Bank Account - Current AED) at company creation, same
  pattern as the existing `journal_approval_threshold`.

### 3.2 `payments` (new) — per D-1

```
id                uuid primary key default gen_random_uuid()
company_id        uuid not null references companies(id)
customer_id       uuid not null references customers(id)
payment_date      date not null
amount            numeric(18,2) not null check (amount > 0)
payment_method    text                          -- enum candidate; not yet specified by deliverables
reference_number  text
bank_account_id   uuid references accounts(id)  -- nullable; falls back to company_settings.default_bank_account_id (D-6)
unapplied_amount  numeric(18,2) not null         -- starts = amount, decrements as applications are added
journal_entry_id  uuid references journal_entries(id)
created_by        uuid not null
created_at        timestamptz not null default now()
updated_at        timestamptz not null default now()

check (unapplied_amount >= 0 and unapplied_amount <= amount)
```

### 3.3 `payment_applications` (new)

```
id             uuid primary key default gen_random_uuid()
payment_id     uuid not null references payments(id) on delete cascade
invoice_id     uuid not null references invoices(id)
applied_amount numeric(18,2) not null check (applied_amount > 0)
applied_at     timestamptz not null default now()
applied_by     uuid not null
```

Sum of `applied_amount` for one `payment_id` can never exceed that
payment's `amount` — enforce with a trigger recomputing
`payments.unapplied_amount` on insert/delete, the same DB-level
defense-in-depth pattern as invoice_lines' discount-XOR constraint and
journal_lines' debit/credit check (A decisions #28/#38/#45/#46) — not
application-layer trust alone.

### 3.4 `write_offs` (new)

```
id                   uuid primary key default gen_random_uuid()
company_id           uuid not null references companies(id)
customer_id          uuid not null references customers(id)
invoice_id           uuid not null references invoices(id)
amount               numeric(18,2) not null check (amount > 0)
reason               text not null
journal_entry_id     uuid references journal_entries(id)  -- approval/approved_by/approved_at all live here (D-8, D-9) — no duplicate column on write_offs
debtor_notified_at   date                                  -- FTA condition: written notice to debtor; nullable until fulfilled
vat_relief_eligible  boolean not null default false        -- flips true via scheduled job once 6mo-since-supply + debtor_notified_at both hold (§4.5a)
vat_relief_flagged_at timestamptz
created_by           uuid not null
created_at           timestamptz not null default now()
```

`approved_by` is deliberately **not** a column here — a write-off's
approval status lives on its `journal_entries` row via A's existing
threshold/approval mechanism (D-8), so duplicating it here would create
two sources of truth for the same fact.

### 3.4a `ecl_loss_rate_policies` (new) — per D-8

Append-only, versioned by `effective_from` rather than edited in place —
same audit-trail-preserving convention as the rest of the project rather
than overwriting a rate history.

```
id              uuid primary key default gen_random_uuid()
company_id      uuid not null references companies(id)
bucket          text not null check (bucket in ('current','0_30','31_60','61_90','90_plus'))  -- mirrors D-5
loss_rate       numeric(6,4) not null check (loss_rate >= 0 and loss_rate <= 1)
effective_from  date not null
created_by      uuid not null
created_at      timestamptz not null default now()

unique (company_id, bucket, effective_from)
```

Active rate for a bucket = latest row with `effective_from <= as_of_date`.

### 3.4b `customers` (extend, second addition) — manual ECL override

- `ecl_override_rate numeric(6,4)` — nullable; when set, this customer's
  entire outstanding balance uses this rate instead of the aging-bucket
  blend, for named high-risk cases (e.g. litigation).
- `ecl_override_reason text` — required alongside the rate, for audit.

### 3.4c `ecl_provision_runs` (new) — per §4.5

```
id                  uuid primary key default gen_random_uuid()
company_id          uuid not null references companies(id)
period_end_date     date not null
required_allowance  numeric(18,2) not null   -- computed total needed this run
prior_allowance     numeric(18,2) not null   -- 1110 balance before this run
adjustment_amount   numeric(18,2) not null   -- required - prior; may be negative (release)
journal_entry_id    uuid references journal_entries(id)
reviewed_by         uuid                     -- lighter, non-blocking review (D-8) — not a posting gate
created_by          uuid not null
created_at          timestamptz not null default now()

unique (company_id, period_end_date)  -- one run per company per month
```

### 3.5 `invoices` (extend) — per D-3

- `paid_at timestamptz` — nullable, set once.

### 3.6 `journal_entry_type` enum (extend)

Current values (schema.sql line ~41-50) are additive-only per its own
comment ("no existing rows use these values"); D adds, in the same style
C did for `sales_invoice`/`credit_note`:

- `customer_payment`
- `advance_receipt`
- `advance_application` (the reclass entry, §4.3)
- `write_off`
- `ecl_provision` (§4.5)

### 3.7 Advisory-lock namespaces

Follows the existing per-company `hashtext('<ns>:' || company_id)`
convention (`quo:`, `qxp:`, `inv:`, `ovd:`, `crn:`, `cnl:`, `rjt:`). D
needs its own numbering sequences wherever a human-facing number is
allocated (payment receipt number, write-off number, if either gets one),
plus an `ecl:` namespace guarding the monthly provisioning run so two
concurrent month-end-close triggers can't double-post the same period
(mirrors the `unique (company_id, period_end_date)` constraint on
`ecl_provision_runs` as belt-and-suspenders, same DB-level
defense-in-depth pattern as everywhere else) — reuse the pattern, don't
invent a new locking approach.

---

## 4. Transactional rules

### 4.1 Status transitions this module wires up

Per the schema's own line-1912 handoff comment: `partially_paid`,
`paid`, and `written_off` are reserved on `invoice_status` with no
transition logic yet. D owns all three:

- `amount_paid` increments only via a `payment_applications` insert —
  never client-set directly (A decision #10 / C decision #3: never trust
  client input for what the backend can derive).
- `amount_paid < grand_total` → `partially_paid`.
- `amount_paid = grand_total` → `paid`, `paid_at` stamped (D-3).
- `written_off` set by the write-off flow (§4.4), independent of
  `amount_paid` reaching `grand_total`.
- Overpayment (an application that would push `amount_paid` above
  `grand_total`) is rejected at the application layer — the excess stays
  in `unapplied_amount` as available advance credit, applied via a
  separate `payment_applications` row against a different invoice, never
  folded into one invoice past 100%.

### 4.2 Payment receipt (full/partial, single/multiple invoices)

- One `payments` row can fund `payment_applications` rows against
  several invoices for the same customer in one transaction.
- GL posting at the *payment* record, not per application: `Dr` Bank
  (`1020`, or `payments.bank_account_id` if set — D-6), `Cr` Accounts
  Receivable (`1100`), for `amount`. One journal entry per payment —
  mirrors C's post-once-at-Issue pattern rather than one entry per line.
- `entry_type = 'customer_payment'` (§3.6).

### 4.3 Advance receipt

- Recorded as a `payments` row with `unapplied_amount = amount`, no
  `payment_applications` rows yet.
- GL posting at receipt: `Dr` Bank (`1020` / `bank_account_id`, D-6),
  `Cr` Customer Advances liability (`2060`, D-7) — **not** AR, since no
  invoice/debit exists yet to offset. `entry_type = 'advance_receipt'`.
  This is the concrete case D-1 exists to handle: the credit account
  depends on whether applications exist at posting time, not on which
  table the row is in.
- Application to a later invoice: a `payment_applications` row is
  inserted, `unapplied_amount` decrements, and a **second**, cash-free
  reclassifying journal entry fires: `Dr` Customer Advances, `Cr`
  Accounts Receivable (`1100`), for the applied amount.
  `entry_type = 'advance_application'`. This reclass entry — not the
  original advance receipt — is what reduces the invoice's `amount_paid`
  and can trigger the §4.1 `partially_paid`/`paid` transition.

### 4.4 Write-off

- Available for invoices in `issued`/`overdue`/`partially_paid`; writes
  off the remaining unpaid balance (`grand_total − amount_paid`) only.
- Sets `invoices.status = 'written_off'` — the already-reserved value,
  not a new one.
- Extends C's existing `POST /invoices/:id/write-off` per D-9, rather
  than a new endpoint. Request adds `reason`, and optionally
  `debtor_notified_at` if notice has already been given (can also be
  set later via a follow-up call, since notification and write-off
  don't have to happen in the same step).
- GL posting (D-8, ratified): `Dr` Allowance for ECL (`1110`), `Cr`
  Accounts Receivable (`1100`), for the written-off balance.
  `entry_type = 'write_off'`. No P&L line at this step — the expense was
  already recognized when the allowance was provisioned (§4.5). If the
  written-off amount exceeds the current `1110` balance (undersized
  provision), the excess still posts `Dr 5640` directly for the shortfall
  — a corner case worth a code comment, not a silent rounding fix.
- Approval: the write-off's `journal_entry_id` goes through A's existing
  threshold-based approval — nothing write-off-specific to build (D-8).
- Undo path: reuse A's standard reversing-entry mechanism
  (`reverse_journal_entry`, schema.sql §10) rather than a write-off-
  specific undo — a written-off invoice that later gets paid is a
  correction, and the project already has one correction mechanism.

### 4.5 ECL provisioning (monthly) — new scope per D-8

Not one of D's original 8 deliverables; added because the accountant's
answer on D-8 requires it for the allowance method to mean anything.

**4.5a — Provisioning run.** As part of month-end close, a
scheduled/triggered run (same category as `mark_overdue_invoices()`,
guarded by the `ecl:` advisory lock, §3.7):

1. For each customer without `ecl_override_rate` set, bucket their
   outstanding invoice balances per D-5's aging buckets and apply the
   active `ecl_loss_rate_policies` rate per bucket (§3.4a).
2. For each customer *with* `ecl_override_rate` set, apply that single
   rate to their full outstanding balance instead.
3. Sum to `required_allowance`; compare against current `1110` balance
   (`prior_allowance`); the difference is `adjustment_amount`.
4. Post one journal entry: `adjustment_amount > 0` → `Dr 5640, Cr 1110`
   (top-up); `adjustment_amount < 0` → `Dr 1110, Cr 5640` (release).
   `entry_type = 'ecl_provision'`.
5. Record the run in `ecl_provision_runs` (§3.4c) — `reviewed_by` is
   populated by whoever signs off during month-end close, but does not
   gate the posting itself (lighter review, per D-8).

**4.5b — VAT-relief eligibility flag.** A separate scheduled function
(same pattern as `mark_overdue_invoices()`) scans `write_offs` where
`vat_relief_eligible = false`, and flips it true once both hold:
`invoices.invoice_date <= as_of_date - interval '6 months'` **and**
`debtor_notified_at is not null`. This does not touch VAT filing itself
— it only sets the flag Module F reads when preparing the return
(Build Order §3).

---

## 5. Reporting

New reports follow H1's established pattern: a Postgres function
filtered through `is_ledger_truth_status()` wherever it aggregates from
`journal_lines`, exposed via a thin read route — not a parallel
Nest-side aggregation (the exact mistake A decision #64 found and fixed
for year-end P&L). Where a report reads subledger data (`payments`,
`write_offs`) rather than `journal_lines` directly, the equivalent local
rule is: only rows with a non-null `journal_entry_id` (actually posted)
count.

### 5.1 Customer ledger

`get_customer_ledger(company_id, customer_id, date_range?)` — unions
posted invoices (debit `1100`), credit notes (credit `1100`), payment
applications (credit `1100`), advance receipts (credit `2060` — shown
separately from the AR-affecting rows, not netted into the same running
balance line), and write-offs (credit `1100`), ordered by date, running
balance computed in SQL.

### 5.2 Aged receivables report

`get_aged_receivables(company_id, as_of_date)` — buckets per D-5;
per-customer rows plus a totals row, over invoices with
`amount_paid < grand_total` and status in
(`issued`, `overdue`, `partially_paid`).

### 5.3 Credit limit check

Evaluated at invoice **Issue** (not draft creation) — matches C's own
"ledger posting happens at Issue, not draft" precedent. Outstanding
balance = sum of open invoice balances minus available unapplied advance
credit for that customer. Non-blocking per D-4.

### 5.4 Customer statement of account

**Scope split, following C §9's own precedent:** D delivers the
underlying data — a statement query returning the customer ledger (§5.1)
plus a running balance, formatted for chasing — as
`GET /reports/customer-statement`. Actual **PDF rendering** stays a
presentation-layer concern, the same category C explicitly deferred
(bilingual PDF invoices, delivery, etc. — C §9, still open per the Build
Order's tracked gap list) — tracked alongside C's other deferred §9
items rather than built one-off here.

### 5.5 Customer payment history / DSO

`get_customer_payment_history(company_id, customer_id)` — per invoice
reaching `paid`: `paid_at − invoice_date` compared against
`payment_terms`. Aggregate to an average actual-days-to-pay per
customer. Only invoices with `paid_at` set (D-3) contribute — partially
paid invoices don't yet have a completion date to measure.

---

## 6. Relationship to existing schema-reserved fields

`partially_paid`/`paid`/`written_off`/`amount_paid` are schema-reserved
on `invoice_status`/`invoices` with no transitions wired — confirmed
directly in `schema.sql` (line ~1912's handoff comment). §4.1 and §4.4
are that wiring. Beyond `paid_at` (D-3), D's write-off flow (§4.4-§4.5)
adds `write_offs.debtor_notified_at` and `write_offs.vat_relief_eligible`
as the FTA-condition tracking Module F will read from — no changes to
C's `invoices`/`credit_notes` tables are needed beyond `paid_at`.

---

## 7. Out of scope for this pass

- **VAT-201 return filing/reclaim mechanics** — Module F, per Build
  Order §3. D computes and flags `vat_relief_eligible` (§4.5b) only.
- **PDF/XLSX/CSV export mechanics** generally — Build Order §8
  (Extended Financial Reports, H-remainder), consistent with §5.4's
  split.
- **Automated dunning/reminder delivery** — presentation/delivery
  category, same bucket as C §9.
- **Multi-currency** payments or advances — not mentioned anywhere in
  A/C and out of scope until raised explicitly.
- **Credit-limit override workflow** — only relevant if D-4 is revisited
  toward "blocking" instead of "alert-only."
- **Supplier-side mirror (Module E / Accounts Payable)** — separate
  module, has its own open Bill-entity question per Build Order §4.

---

## 8. Suggested next step

**All decisions (D-1 through D-9) are now ratified** — against
`schema.sql`, the real COA, and explicit accountant sign-off on D-8.
Nothing in this spec remains a placeholder or a "TBC." §3's schema
migration (note the larger surface now: `write_offs`,
`ecl_loss_rate_policies`, `ecl_provision_runs`, plus the `customers` and
`invoices` extensions) can proceed alongside §4's posting functions.