# Module 1.1.D — Accounts Receivable Management
## Feature Specification (Source of Truth)

Part of Module 1.1 · AI-Based Accounting Foundation, inFINity Phase 1 (MVP).
This is the authoritative scope document for Module 1.1.D only — do not
infer scope from Module 1.1.A/C/H1 or other 1.1.B–H modules.

**Status: scoped and decision-logged, not yet built.** §2 below is now a
ratified decision log (D-1…D-5), grounded against `schema.sql` rather than
assumption — matching the discipline `feature-spec.md` (A) and
`feature-spec-1_1_C.md` (C) use. It is still a *pre-build* document: no
code exists for D yet, so nothing here claims to have been tested. As
build proceeds, any decision that turns out to need revision gets a new
numbered entry appended (D-6, D-7…) rather than silently edited — same
rule A's and C's logs follow.

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
| 7 | Write-off — bad debt write-off (VAT relief calc deferred to F) | §4.4 |
| 8 | Customer payment history — average actual days to pay vs. terms | §5.5 |

**Explicitly out of scope for this pass** (see §7 for detail): the VAT
bad-debt-relief *calculation* (Module F owns it — D posts a write-off
against the already-reserved `written_off` status only, per Build Order
§3's note); PDF/XLSX/CSV export mechanics generally (Build Order §8,
H-remainder); automated dunning/reminder delivery; multi-currency;
partial reversal of a write-off beyond A's standard reversal mechanism.

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

### D-2 — GL accounts: AR is settled fact; Bank, Customer Advances, and Bad Debt Expense are open lookups

**Decision:** do not invent account numbers for anything not already in
`schema.sql`.

- Accounts Receivable = **`1100`**, confirmed directly from
  `post_invoice_to_ledger` (schema.sql line ~1545-1548) — not a proposal,
  it's what the running system already posts against.
- Bank/Cash, Customer Advances (liability), and Bad Debt Expense appear
  **nowhere** in `schema.sql` — no hardcoded number, no seed data. Before
  D's posting functions are written, someone must confirm against the
  actual `Chart_of_Accounts_-_inFINity.xlsx`: (a) the Bank/Cash account(s)
  to debit, (b) whether a Customer Advances / Unearned Deposits liability
  account already exists in the 179-account COA or needs adding as a new
  account (itself a small decision to log when it happens, same as any
  COA change), (c) the Bad Debt Expense account.
- This mirrors C's own intro discipline of consulting the finalized COA
  for every account-numbering call — D-2 is a process commitment, not a
  guess dressed up as one.

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

---

## 3. Schema additions

Building on C's `customers` / `invoices` / `credit_notes`, following the
same column-naming and constraint conventions used throughout
`schema.sql` (uuid PKs via `gen_random_uuid()`, `company_id` FK on every
tenant-scoped table, `created_at`/`updated_at timestamptz not null default
now()`).

### 3.1 `customers` (extend)

- `credit_limit numeric(18,2)` — nullable; `null` = no limit enforced.

### 3.2 `payments` (new) — per D-1

```
id                uuid primary key default gen_random_uuid()
company_id        uuid not null references companies(id)
customer_id       uuid not null references customers(id)
payment_date      date not null
amount            numeric(18,2) not null check (amount > 0)
payment_method    text                          -- enum candidate; not yet specified by deliverables
reference_number  text
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
id                 uuid primary key default gen_random_uuid()
company_id         uuid not null references companies(id)
customer_id        uuid not null references customers(id)
invoice_id         uuid not null references invoices(id)
amount             numeric(18,2) not null check (amount > 0)
reason             text not null
journal_entry_id   uuid references journal_entries(id)
vat_relief_status  text not null default 'pending_f_module'  -- placeholder; real enum belongs to Module F
approved_by        uuid
created_by         uuid not null
created_at         timestamptz not null default now()
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

### 3.7 Advisory-lock namespaces

Follows the existing per-company `hashtext('<ns>:' || company_id)`
convention (`quo:`, `qxp:`, `inv:`, `ovd:`, `crn:`, `cnl:`, `rjt:`). D
needs its own numbering sequences wherever a human-facing number is
allocated (payment receipt number, write-off number, if either gets one)
— reuse the pattern, don't invent a new locking approach.

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
- GL posting at the *payment* record, not per application: `Dr`
  Bank/Cash (account TBC per D-2), `Cr` Accounts Receivable (`1100`),
  for `amount`. One journal entry per payment — mirrors C's
  post-once-at-Issue pattern rather than one entry per line.
- `entry_type = 'customer_payment'` (§3.6).

### 4.3 Advance receipt

- Recorded as a `payments` row with `unapplied_amount = amount`, no
  `payment_applications` rows yet.
- GL posting at receipt: `Dr` Bank, `Cr` Customer Advances liability
  (account TBC per D-2) — **not** AR, since no invoice/debit exists yet
  to offset. `entry_type = 'advance_receipt'`. This is the concrete case
  D-1 exists to handle: the credit account depends on whether
  applications exist at posting time, not on which table the row is in.
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
- GL posting: `Dr` Bad Debt Expense (account TBC per D-2), `Cr` Accounts
  Receivable (`1100`), for that balance. `entry_type = 'write_off'`.
- Requires Owner-level authorization, matching A's approval-threshold
  model (A §4.1) — a write-off is a real financial-loss recognition, not
  a routine transaction. `write_offs.approved_by` records it.
- 6-month FTA eligibility is informational only at this layer:
  `vat_relief_status` starts `pending_f_module` regardless of invoice
  age; it does not gate whether a write-off can happen. The actual
  VAT-201 relief calculation and eligibility gate belong to Module F
  per Build Order §3 — D's job stops at posting a correct write-off and
  leaving a clean flag for F.
- Undo path: reuse A's standard reversing-entry mechanism
  (`reverse_journal_entry`, schema.sql §10) rather than a write-off-
  specific undo — a written-off invoice that later gets paid is a
  correction, and the project already has one correction mechanism.

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
applications (credit `1100`), advance receipts (credit Customer
Advances — shown separately from the AR-affecting rows, not netted into
the same running balance line), and write-offs (credit `1100`), ordered
by date, running balance computed in SQL.

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
are that wiring. No changes to C's `invoices`/`credit_notes` tables are
needed beyond `paid_at` (D-3) — D reads and writes existing C columns
plus its own new tables.

---

## 7. Out of scope for this pass

- **VAT bad-debt relief calculation** — Module F, per Build Order §3. D
  posts the write-off entry and a status flag only.
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

The two lookups D-2 flags — the actual Bank/Cash account(s) and whether
Customer Advances/Bad Debt Expense already exist in the finalized COA —
are the only remaining blockers before writing the posting functions in
§4. Everything else in this spec is grounded against confirmed
`schema.sql` behavior.