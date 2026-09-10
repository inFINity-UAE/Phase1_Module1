# Module 1.1.D — Accounts Receivable Management
## Feature Specification (Source of Truth)

Part of Module 1.1 · AI-Based Accounting Foundation, inFINity Phase 1 (MVP).
This is the authoritative scope document for Module 1.1.D only — do not
infer scope from Module 1.1.A/C/H1 or other 1.1.B–H modules.

**Status: ✅ built and verified (2026-09-10).** Schema (§3), posting
RPCs (§4), Nest AR surface, shared daily scheduler jobs (§4.5 / D-16),
and AR reports (§5) are live. §2 is the ratified decision log
(D-1…D-17); §9 is the chronological index. Grounded against `schema.sql`,
the finalized `Chart_of_Accounts_-_inFINity.xlsx`, accountant/owner
sign-off, and (for D-11) the TC9 test pack — same discipline as
`feature-spec.md` (A) and `feature-spec-1_1_C.md` (C). No D-1…D-15
entry was silently edited; build-time locks that were previously
unspecified are appended as D-16+. Explicit deferrals remain in §7.

**D-P13 verification (2026-09-10, Testing 1.1.A `kaihxmsskblynwjmwvfh`):**
fresh `schema.sql` apply + `seed_finalized_coa_demo_company_0002.sql` +
`seed_uae_public_holidays.sql` clean (25 public tables, 183 accounts,
38 holidays); all ten `apply_*.sql` scripts idempotent ×2; full
`npx jest` **573 passed** across 59 suites (vs Module C baseline
**544/544** — net +29 D tests) with **1 suite failing to compile**
(`journal-entries.service.spec.ts` mock missing D-P11
`listPeriodsPendingEcl` / `addBusinessDays` / `runEclProvision` —
TypeScript only, not a runtime/DB regression); `verify-auth-module-imports.mjs`
17/17 OK; `hijri_holiday_projection.py` self-check OK (worst miss 1 day).

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

### D-10 — ECL provisioning schedule: T+5 business days, holiday-aware, never skipped

**Decision:** the run (§4.5a) fires 5 business days after
`period_end`, not on a fixed calendar date — late-arriving invoices/
payments get time to post before aging buckets are computed, and it
lands after the AR aging position is effectively final but before the
period can hard-close. If that date falls on a weekend or public
holiday, it pushes to the next business day rather than being skipped —
a late cycle is recoverable, a missed one isn't.

**Consequence — new supporting schema:**
- `public_holidays (id, company_id nullable [null = UAE-wide], holiday_date, description)`
  — a table that doesn't exist anywhere in `schema.sql` today. Seed data
  was left out of the original draft because UAE public holidays are
  partly lunar-calendar-based and needed an actual government source
  rather than a guess. **Superseded by D-14**, which sources them from
  Cabinet Resolution No. (27) of 2024 and seeds three years forward.
- `company_settings.weekend_days smallint[]` — which ISO weekdays count
  as non-business days for this company. Default Saturday + Sunday was
  originally an unconfirmed assumption; **confirmed by the owner in
  D-13**.

**Consequence — sequencing dependency on Module A:** the provisioning
run must execute before whatever action transitions
`accounting_periods.status` to `closed`. Rather than trying to hook into
A's close sequence (which this spec doesn't own), D's provisioning RPC
defensively checks the target period isn't already `closed` and errors
loudly if it is — reusing the same period-status guard pattern A's own
posting functions already use, not inventing a new one.

**"AR aging snapshot is final" — resolved without a new snapshot
table.** H1's own precedent (§5, "no new tables") argues against
persisting one here too: by construction, T+5 business days after
`period_end` is late enough that a live call to `get_aged_receivables`
(§5.2) with `as_of_date = period_end` already reflects the settled
position. No `ar_aging_snapshots` table needed — the *timing* of the run
is what makes it "final," not a stored artifact.

### D-11 — Two approval thresholds, not one

**Decision:** `company_settings` gets a second column,
`write_off_approval_threshold numeric(18,2)`, seeded to **AED 5,000** —
separate from the existing `journal_approval_threshold` (general journal
entries, **AED 50,000**). A write-off posting function resolves which
threshold applies by `entry_type`: `write_off` → the tighter, dedicated
threshold; everything else → the existing general one;
`ecl_provision` → **always non-blocking**, regardless of amount, per
D-8's "lighter, non-blocking review" call — it's a systematic estimate,
not a discretionary loss judgment.

*(Verified against TC9: the test pack's own assertion message reads
"App threshold is `APPROVAL_THRESHOLD` AED (Excel specifies 50,000)" —
i.e. TC9 asserts the running app's configured threshold against the
Excel-sourced figure of 50,000, the same number recorded here. No
discrepancy — the two sources agree, so AED 50,000 stands confirmed,
not merely "as given.")*

**Why lower for write-offs specifically:** a write-off is an irreversible
confirmed loss, not just a large expense — the tighter number reflects
risk category, not size, which is exactly why one shared threshold
wouldn't have worked (a AED 6,000 write-off needs sign-off even though
it's well under the general AED 50,000 line).

### D-12 — Payment routing by method, plus sub-account support for multiple bank accounts

**Decision — payment-method-aware account routing.** `payments.
payment_method` becomes a proper enum
(`'cash','bank_transfer','cheque','card','pos','other'`), and the
posting function picks the debit account by method when
`bank_account_id` isn't explicitly set:

| `payment_method` | Default debit account |
|---|---|
| `cash` | `1010` Cash on Hand |
| `bank_transfer`, `cheque` | `company_settings.default_bank_account_id` (D-6, `1020`) |
| `card`, `pos` | `1070` Merchant / Payment Gateway Clearing |
| `other` | `default_bank_account_id`, same as bank transfer |

Card/POS payments route through `1070` rather than straight to `1020`,
since settlement typically lands a day or two later, net of processor
fees — confirmed for real in the COA (`1070 Merchant / Payment Gateway
Clearing`, Cash & Bank band). **The `1070 → 1020` settlement/clearing
entry itself is explicitly out of scope for D** (§7) — matching a bank
statement line to the clearing balance is a reconciliation concern, not
an AR concern; for now that's a manual journal entry through A's normal
posting path (`Dr 1020, Cr 1070`) until a dedicated reconciliation
module exists.

**Decision — multiple bank accounts via existing hierarchy, no new
schema.** `accounts.parent_account_id`/`depth` already supports up to
4 levels (schema.sql line 114-115) — a second or third bank account is
simply a new account created as a child of `1020` through Module A's
existing account-management flow (its own 4-digit number; `account_number`
is a fixed `char(4)`, so there's no dotted "1020.1" — a true sibling
account like a newly-numbered `10xx`, parented to `1020`). D doesn't need
new schema for this: `payments.bank_account_id` (§3.2, D-6) already
accepts any `accounts.id`, and the payment-entry picker should list any
active account under the Cash & Bank sub-category, not hardcode to
`1020` alone. `company_settings.default_bank_account_id` stays a single
company-wide default; per-payment override via `bank_account_id` handles
the rest.

### D-13 — Weekend days: Sat/Sun confirmed; no settings admin API in D

**Decision:** `company_settings.weekend_days` keeps its `{6,7}`
(Saturday + Sunday, ISO-8601 weekday numbers) default — **confirmed by
the owner**, closing D-10's flagged assumption. The column stays a
`smallint[]` so the value is company-configurable at the data layer, but
**D ships no endpoint to read or write company settings**. Changing
`weekend_days` — or any other `company_settings` value — remains a
DB-level task in this pass.

**Why:** no settings admin API exists anywhere in the project today.
`company_settings` is read-only and internal, reached solely through
`JournalEntriesRepository.getCompanySettings()`; nothing writes it
outside test setup. Exposing it is a cross-cutting administration
surface (which roles may edit which setting, audit-logging of changes,
validation per column) that belongs to a company-administration module,
not to Accounts Receivable — the same boundary reasoning D-4 used to
refuse a credit-limit override workflow and D-9 used to avoid a second
write-off endpoint. Added to §7 as an explicit exclusion so it stays
tracked rather than forgotten.

**Note on the default itself:** Sat/Sun is the UAE federal standard, but
private-sector practice genuinely varies (some employers still run a
Friday–Saturday weekend, and Sharjah's public sector runs a four-and-a-
half-day week). The column exists precisely because the default is not
universal — this decision defers the *editing surface*, not the
configurability.

### D-14 — Public holidays: sourced from Cabinet Resolution 27/2024, seeded 3 years, lunar dates PROVISIONAL

**Decision:** `public_holidays` (§3.1b) is pre-populated through 2029
from the UAE's own legal source, with every lunar-calendar entry stored
as `PROVISIONAL` and correctable in place once the actual date is
announced.

**Source, in the order the accounting-engine rule requires:**

1. **Cabinet Resolution No. (27) of 2024 Concerning the Public Holidays
   in the State**, Article 1 — the legal instrument, published on the
   UAE Legislation portal
   (`uaelegislation.gov.ae/en/legislations/2595`), in force from
   1 January 2025. Its Article 1 table is the authoritative list of the
   seven holidays and their durations.
2. The UAE Government portal `u.ae`'s public-holidays page, which
   mirrors the same list and adds the moon-sighting footnote and the
   30-Ramadan rule for Eid Al Fitr's fourth day.

**No official machine-readable feed exists.** The UAE open data portal
(`bayanat.ae`) publishes no holidays dataset, and `u.ae` states the
list as *rules*, not dates. So there is deliberately **no auto-sync
job** in this design — the calendar is seeded data plus a correction
path, not an integration.

**Why the dates can't simply be computed and trusted** — two things in
the Resolution itself make any pre-computed lunar date provisional:

- Only two holidays are fixed on the Gregorian calendar (Gregorian New
  Year, 1 January; National Day, 2–3 December). The other five are Hijri
  dates, and `u.ae` states plainly that *"Islamic holidays are determined
  according to moon sighting"* — an announcement, not an algorithm.
- **Article 2** lets the Cabinet move any non-Eid holiday to the
  beginning or end of the week by resolution. (Article 3 bounds this: a
  holiday coinciding with another holiday or falling on the weekend is
  *not* transferred.)

**Consequence:** `public_holidays` gains a `status` column
(`'PROVISIONAL' | 'CONFIRMED'`) and a `source` column, and D adds one
small admin route so a projected date can be corrected and confirmed
when the announcement lands (§3.1b). This is the *only* administrative
write surface D adds — narrowly scoped to holiday dates, not the
general settings API D-13 declines to build.

**Scheduling consequence (§4.5a):** the T+5-business-day calculation
treats `PROVISIONAL` rows exactly like `CONFIRMED` ones. A projection
that is off by a day still lands on or beside a real day off, and per
D-10's own reasoning a late provisioning cycle is recoverable while a
missed one isn't — so there is no case for skipping unconfirmed
holidays.

### D-15 — Month-end close cadence: calendar month-end, QuickBooks/Xero-style

**Decision:** `accounting_periods` follow the same convention as
QuickBooks/Xero — one period per **calendar month**, `period_end` is the
last calendar day of that month (`period_start`/`period_end` are still
client-supplied per A's existing `accounting_periods` create/update
routes; D adds no new period-creation logic or schema). No fixed
mid-month close day and no company-configurable close-day offset — this
app's periods are calendar months, matching the product category it's
modeled on rather than a custom fiscal-close calendar.

**Why this resolves D-10's open dependency:** D-10's provisioning run
fires `period_end` + 5 business days, but nothing previously said when
a period actually ends. With `period_end` anchored to the last calendar
day of each month, the scheduler now has a concrete date to compute
against for every company — e.g. a January period closes 2026-01-31, so
(weekend/holiday-aware per D-10/D-13/D-14) the ECL run targets on or
after 2026-02-07 (5 business days out, adjusted for Sat/Sun and any
`public_holidays` row in that window).

**Scope note:** this does not add a periods-admin API or an
auto-period-creation job — both remain out of scope for D (§7, same
boundary D-13 draws). It only fixes what the close date *is* once a
period exists, which is what D-10's scheduler needed to anchor to.
Closes the "still needed" flag in §4.5a and the Build Order dependency
raised ahead of D-P11.

### D-16 — ECL + VAT-relief eligibility share C's existing 01:00 UTC cron

**Decision (build-time lock, 2026-09-10):** the §4.5a ECL provisioning
run and the §4.5b `mark_vat_relief_eligible` scan register on the same
`RecurringJournalSchedulerService` **01:00 UTC** job that already runs
recurring generation, quotation expiry, and invoice overdue (C decisions
#20–#21) — order: recurring → expiry → overdue → VAT relief → ECL.
**No second Nest `@Cron` / scheduler process** for D.

**Why:** D-10 specifies *when* ECL fires (`period_end` + 5 business days,
catch-up if late) but not *which process* hosts it. Reusing C's proven
daily slot matches A's #62–#63 / C #15 pattern and avoids duplicate
schedulers racing the same advisory locks.

**Does not revise D-10:** timing, holiday-awareness, and never-skip
catch-up rules stand; this only names the host.

### D-17 — Late `debtor_notified_at` via `PATCH /invoices/:id/debtor-notified`

**Decision (build-time lock, 2026-09-10):** when written notice to the
debtor is given *after* write-off, Nest exposes
`PATCH /invoices/:id/debtor-notified` (body: `debtor_notified_at`) on an
already-`written_off` invoice. Write-off itself still accepts optional
`debtor_notified_at` on `POST /invoices/:id/write-off` (D-9 / §4.4).

**Why:** §4.4 already allowed a follow-up call without naming the route;
build locked a dedicated PATCH rather than overloading write-off or a
generic write-offs CRUD surface. Module F still owns VAT-201 reclaim;
this only completes D's FTA-condition flag inputs for §4.5b.

**Does not revise D-9:** write-off remains an extension of C's existing
POST URL; PATCH is additive for the post-write-off notice step only.

---

## 3. Schema additions

Building on C's `customers` / `invoices` / `credit_notes`, following the
same column-naming and constraint conventions used throughout
`schema.sql` (uuid PKs via `gen_random_uuid()`, `company_id` FK on every
tenant-scoped table, `created_at`/`updated_at timestamptz not null default
now()`).

### 3.1 `customers` (extend)

- `credit_limit numeric(18,2)` — nullable; `null` = no limit enforced.

### 3.1a `company_settings` (extend) — per D-6, D-10, D-11

- `default_bank_account_id uuid references accounts(id)` — seeded to
  account `1020` (Bank Account - Current AED) at company creation, same
  pattern as the existing `journal_approval_threshold`.
- `write_off_approval_threshold numeric(18,2)` — D-11, seeded **AED
  5,000**, separate from the existing `journal_approval_threshold`
  (**AED 50,000**).
- `weekend_days smallint[]` — D-10, seeded `{6,7}` (ISO-8601 Sat/Sun) —
  **confirmed by the owner, D-13**. No API writes it in this pass (D-13).

### 3.1b `public_holidays` (new) — per D-10, D-14

```
id             uuid primary key default gen_random_uuid()
company_id     uuid references companies(id)   -- nullable: null = UAE-wide
holiday_date   date not null
description    text not null
status         text not null default 'PROVISIONAL'
               check (status in ('PROVISIONAL','CONFIRMED'))
source         text                             -- e.g. 'Cabinet Resolution 27/2024 Art.1'
created_at     timestamptz not null default now()
updated_at     timestamptz not null default now()
```

Uniqueness needs **two partial indexes**, not one `unique (company_id,
holiday_date)` — a plain unique constraint treats NULLs as distinct, so
it would happily admit duplicate UAE-wide rows for the same date, which
is exactly the row most likely to be inserted twice by a re-run seed:

```
create unique index public_holidays_company_date_uq
  on public_holidays (company_id, holiday_date) where company_id is not null;
create unique index public_holidays_uae_date_uq
  on public_holidays (holiday_date) where company_id is null;
```

**Resolution order:** a company-scoped row (`company_id` non-null) takes
precedence over the UAE-wide row (`company_id is null`) for the same
date. This is what lets one company correct or drop a date without
editing the shared calendar every other company reads.

**Correction route (D-14).** `GET`/`POST`/`PATCH`/`DELETE
/public-holidays` — company-scoped, guarded by the same
`SupabaseAuthGuard` + `CompanyMembershipGuard` + Owner/Accountant role
check the rest of D uses. `PATCH` is the one that matters: it moves
`holiday_date` and flips `status` to `CONFIRMED` once the Cabinet
announces the real date. Writes always land on company-scoped rows; the
UAE-wide (`company_id is null`) rows are seed data, not editable through
the API.

#### Seed data — per D-14

Two sources, in the priority order the accounting-engine rule requires:
**Cabinet Resolution No. (27) of 2024, Article 1** (the legal list of
holidays and their durations) and the `u.ae` public-holidays page (same
list, plus the moon-sighting and 30-Ramadan footnotes). Seeded as
UAE-wide rows (`company_id is null`), covering the remainder of 2026
through 2029.

`CONFIRMED` — fixed on the Gregorian calendar by Article 1, so no
projection is involved:

| Date | Description |
|---|---|
| `2026-12-02`, `2026-12-03` | National Day (Eid Al Etihad) |
| `2027-01-01` | Gregorian New Year |
| `2027-12-02`, `2027-12-03` | National Day |
| `2028-01-01` | Gregorian New Year |
| `2028-12-02`, `2028-12-03` | National Day |
| `2029-01-01` | Gregorian New Year |
| `2029-12-02`, `2029-12-03` | National Day |

`PROVISIONAL` — the five Hijri holidays of Article 1, projected from the
astronomical new moon (Meeus' phase series) under the Umm al-Qura
criterion: the month begins the day after conjunction when conjunction
precedes sunset at Mecca, otherwise two days after.

| Dates | Description | Hijri (Art. 1) |
|---|---|---|
| `2027-03-09` … `2027-03-11` | Eid Al Fitr | 1–3 Shawwal 1448 |
| `2027-05-15` | Arafah Day | 9 Dhu al-Hijjah 1448 |
| `2027-05-16` … `2027-05-18` | Eid Al Adha | 10–12 Dhu al-Hijjah 1448 |
| `2027-06-06` | Hijri New Year | 1 Muharram 1449 |
| `2027-08-14` | Prophet Mohammed's Birthday | 12 Rabi' al-Awwal 1449 |
| `2028-02-26` … `2028-02-28` | Eid Al Fitr | 1–3 Shawwal 1449 |
| `2028-05-04` | Arafah Day | 9 Dhu al-Hijjah 1449 |
| `2028-05-05` … `2028-05-07` | Eid Al Adha | 10–12 Dhu al-Hijjah 1449 |
| `2028-05-25` | Hijri New Year | 1 Muharram 1450 |
| `2028-08-03` | Prophet Mohammed's Birthday | 12 Rabi' al-Awwal 1450 |
| `2029-02-14` … `2029-02-16` | Eid Al Fitr | 1–3 Shawwal 1450 |
| `2029-04-23` | Arafah Day | 9 Dhu al-Hijjah 1450 |
| `2029-04-24` … `2029-04-26` | Eid Al Adha | 10–12 Dhu al-Hijjah 1450 |
| `2029-05-14` | Hijri New Year | 1 Muharram 1451 |
| `2029-07-24` | Prophet Mohammed's Birthday | 12 Rabi' al-Awwal 1451 |

**Known accuracy of the projection, measured rather than asserted.**
Calibrated against six dates with published actuals, it reproduced five
exactly (1 Shawwal 1420 → 2000-01-08; 1 Ramadan 1447 → 2026-02-18;
1 Shawwal 1447 → 2026-03-20; 9 Dhu al-Hijjah 1447 → 2026-05-26;
12 Rabi' al-Awwal 1448 → 2026-08-25) and missed one by a single day
(1 Muharram 1448: projected 2026-06-16, announced 2026-06-15). **±1 day
is the expected error, not the exception** — which is the whole reason
every row above ships as `PROVISIONAL` rather than as fact.

The projection is reproducible, not a hand-copied table:
`scripts/hijri_holiday_projection.py` regenerates the rows above and
asserts the six calibration dates on every run.

**Two things deliberately not seeded**, because neither is derivable in
advance:

- **Eid Al Fitr's possible fourth day.** `u.ae` notes that if Ramadan
  runs 30 days, day 30 is also a holiday (this is why UAE Eid Al Fitr
  2026 ran 19–22 March, not 20–22). Whether it applies depends on the
  observed length of Ramadan, so only the three days Article 1 fixes are
  seeded.
- **Article 2 transfers.** The Cabinet may move any non-Eid holiday to
  the start or end of the week by resolution. That is an announcement,
  not a rule that can be pre-applied — it is handled by correcting the
  row through the `PATCH` route above.

Both are corrections in the same direction: seed the legal baseline,
confirm against the announcement. Re-running the seed must therefore be
idempotent and must **not** overwrite a row already moved to
`CONFIRMED` — `on conflict do nothing`, matching the
`seed_finalized_coa_demo_company_0002.sql` convention.

### 3.2 `payments` (new) — per D-1

```
id                uuid primary key default gen_random_uuid()
company_id        uuid not null references companies(id)
customer_id       uuid not null references customers(id)
payment_date      date not null
amount            numeric(18,2) not null check (amount > 0)
payment_method    payment_method_type            -- new enum (D-12): 'cash','bank_transfer','cheque','card','pos','other'
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
- GL posting at the *payment* record, not per application: `Dr` the
  routed debit account (D-12 — `1010` cash, `1020`/default bank for
  transfer/cheque, `1070` for card/POS, or an explicit
  `payments.bank_account_id` override), `Cr` Accounts Receivable
  (`1100`), for `amount`. One journal entry per payment — mirrors C's
  post-once-at-Issue pattern rather than one entry per line.
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
  set later via `PATCH /invoices/:id/debtor-notified` per D-17, since
  notification and write-off don't have to happen in the same step).
- GL posting (D-8, ratified): `Dr` Allowance for ECL (`1110`), `Cr`
  Accounts Receivable (`1100`), for the written-off balance.
  `entry_type = 'write_off'`. No P&L line at this step — the expense was
  already recognized when the allowance was provisioned (§4.5). If the
  written-off amount exceeds the current `1110` balance (undersized
  provision), the excess still posts `Dr 5640` directly for the shortfall
  — a corner case worth a code comment, not a silent rounding fix.
- Approval: the write-off's `journal_entry_id` goes through A's existing
  threshold-based approval, but resolved against
  `write_off_approval_threshold` (D-11, AED 5,000), not the general
  `journal_approval_threshold` — nothing else write-off-specific to
  build.
- Undo path: reuse A's standard reversing-entry mechanism
  (`reverse_journal_entry`, schema.sql §10) rather than a write-off-
  specific undo — a written-off invoice that later gets paid is a
  correction, and the project already has one correction mechanism.

### 4.5 ECL provisioning (monthly) — new scope per D-8

Not one of D's original 8 deliverables; added because the accountant's
answer on D-8 requires it for the allowance method to mean anything.

**4.5a — Provisioning run.** Scheduled per D-10: `period_end` + 5
business days, weekend/holiday-aware via `company_settings.weekend_days`
(`{6,7}`, D-13) and `public_holidays` — counting `PROVISIONAL` rows as
non-business days identically to `CONFIRMED` ones, per D-14 — hosted on
the shared daily `RecurringJournalSchedulerService` 01:00 UTC cron
(D-16), guarded against an already-`closed` period, and
guarded by the `ecl:` advisory lock (§3.7) so two concurrent triggers
can't double-post the same period.

**Seed rates (provisional, not company-calibrated):** no company-specific
loss history exists yet, so `ecl_loss_rate_policies` seeds with generic
industry benchmarks rather than an invented company-specific number.
These are explicitly placeholders — the D-8 review cadence already
calls for reassessing rates yearly against real write-off history, and
that reassessment is what turns these from generic into calibrated:

| Bucket | Seed rate |
|---|---|
| `current` | 0.75% |
| `0_30` | 2% |
| `31_60` | 7.5% |
| `61_90` | 20% |
| `90_plus` | 40% |

Single midpoint values chosen from the benchmark ranges rather than
range endpoints, since `ecl_loss_rate_policies.loss_rate` is a single
number per bucket, not a range — worth a code comment noting these are
provisional so nobody mistakes them for a ratified figure later.

**Opening allowance balance:** no existing informal provision or
write-off history was identified, so `1110`'s opening balance is
**AED 0** — the first monthly run builds the allowance up from scratch
via A's normal opening-balance mechanism, rather than guessing at a
non-zero starting figure. Standard for a first implementation.

**Manual overrides at go-live:** none seeded — `ecl_loss_rate_policies`
and `customers.ecl_override_rate` start empty; specific high-risk
customers get flagged as and when they're actually identified, not
invented now.

**Month-end close date/cadence:** resolved by D-15 — calendar
month-end, QuickBooks/Xero-style. `period_end` is always the last
calendar day of the month, giving the scheduler a concrete date to
anchor T+5-business-days to.

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
(same pattern as `mark_overdue_invoices()`, same daily cron host per
D-16) scans `write_offs` where
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

`partially_paid`/`paid`/`amount_paid`/`paid_at` are wired by §4.1
(`trg_refresh_invoice_amount_paid_from_applications` on
`payment_applications`; client mutation of `amount_paid`/`paid_at`
blocked). `written_off` is wired by §4.4 (`create_invoice_write_off` +
Nest post via D-11 `write_off_approval_threshold`). Beyond `paid_at`
(D-3), D's write-off flow (§4.4-§4.5) adds `write_offs.debtor_notified_at`
and `write_offs.vat_relief_eligible` as the FTA-condition tracking Module F
will read from — no changes to C's `invoices`/`credit_notes` tables are
needed beyond `paid_at`.

---

## 7. Out of scope for this pass

- **`1070 → 1020` settlement/clearing entries** (D-12) — bank
  reconciliation, not an AR concern; manual journal entry until a
  dedicated module exists.
- **VAT-201 return filing/reclaim mechanics** — Module F, per Build
  Order §3. D computes and flags `vat_relief_eligible` (§4.5b) only.
- **PDF/XLSX/CSV export mechanics** generally — Build Order §8
  (Extended Financial Reports, H-remainder), consistent with §5.4's
  split.
- **Automated dunning/reminder delivery** — presentation/delivery
  category, same bucket as C §9.
- **Multi-currency** payments or advances — not mentioned anywhere in
  A/C and out of scope until raised explicitly.
- **Company-settings admin API/UI** (D-13) — changing `weekend_days`,
  either approval threshold, or `default_bank_account_id` is a DB-level
  task until a dedicated company-administration module exists. D reads
  `company_settings`; it never writes it. The one exception is
  `public_holidays`, which gets its own narrow admin route per D-14.
- **Credit-limit override workflow** — only relevant if D-4 is revisited
  toward "blocking" instead of "alert-only."
- **Supplier-side mirror (Module E / Accounts Payable)** — separate
  module, has its own open Bill-entity question per Build Order §4.

---

## 8. Build status / sign-off

**Module 1.1.D is built and signed off as of 2026-09-10** (decisions
D-1…D-17). Schema (§3), posting functions (§4), Nest AR routes,
scheduler jobs (D-16), and reports (§5) are in `schema.sql` and the
Nest app. §7 deferrals are intentional carry-forward, not incomplete D
scope.

**D-P13 verification numbers (2026-09-10):**

| Check | Result |
|---|---|
| Fresh-DB `schema.sql` + COA seed + UAE holidays seed | Clean (25 tables / 183 accounts / 38 holidays) |
| All `docs/source-of-truth/apply_*.sql` ×2 | Idempotent (10/10 both passes) |
| Full `npx jest` | **573 passed**; 59/60 suites green (baseline was **544/544**) |
| Known suite compile gap | `journal-entries.service.spec.ts` — mock missing `listPeriodsPendingEcl`, `addBusinessDays`, `runEclProvision` (D-P11); fix is test-only |
| `verify-auth-module-imports.mjs` | 17/17 guarded controllers OK |
| `hijri_holiday_projection.py` | Self-check OK (worst miss 1 day) |

**Decision-log hygiene:** no D-1…D-15 entry was rewritten. Build-time
locks appended as **D-16** (shared 01:00 UTC cron host) and **D-17**
(late `debtor_notified_at` PATCH). Pre-build closures that still hold:
D-11 AED 50,000 general threshold (TC9), D-13 weekend Sat/Sun,
D-14 Cabinet Resolution holiday seed, D-15 calendar month-end.

---

## 9. Decision Log Index

Chronological index for traceability — full text of each entry is in §2.
Same discipline as `feature-spec-1.1.C.md` §11: never silently edit an
existing row; append D-18+ if a decision must change.

| # | Date | Summary | Detail in |
|---|------|---------|-----------|
| D-1 | 2026-09-04 | One `payments` table for both payments and advances (zero applications = advance) | §2 D-1, §3.2, §4.2–§4.3 |
| D-2 | 2026-09-04 | GL accounts resolved against finalized COA (`1100`/`1020`/`2060`/`5640`/`1110`) — not invented | §2 D-2, §4 |
| D-3 | 2026-09-04 | `invoices.paid_at` new column, set once when status first reaches `paid` | §2 D-3, §4.1, §6 |
| D-4 | 2026-09-04 | Credit limit alert-only at invoice Issue — non-blocking, no override workflow | §2 D-4, §5.3 |
| D-5 | 2026-09-04 | Aging buckets include explicit `current` (not-yet-due), not folded into 0–30 | §2 D-5, §5.2 |
| D-6 | 2026-09-04 | `company_settings.default_bank_account_id`, seeded to COA `1020` | §2 D-6, §3.1a, §4.2 |
| D-7 | 2026-09-04 | Customer advances liability is `2060`, not `2050` | §2 D-7, §4.3 |
| D-8 | 2026-09-04 | Bad-debt model: allowance (ECL) method — write-off vs `1110`, monthly provision via `5640` | §2 D-8, §4.4–§4.5 |
| D-9 | 2026-09-04 | Write-off extends C's `POST /invoices/:id/write-off` — no parallel endpoint | §2 D-9, §4.4 |
| D-10 | 2026-09-08 | ECL run at `period_end` + 5 business days, holiday-aware, never skipped (catch-up) | §2 D-10, §4.5a |
| D-11 | 2026-09-08 | Two thresholds: write-off AED 5,000; general journal AED 50,000 (TC9); `ecl_provision` non-blocking | §2 D-11, §3.1a, §4.4 |
| D-12 | 2026-09-08 | Payment-method debit routing (`1010`/`1020`/`1070`) + multi-bank via `bank_account_id`; `1070→1020` settlement out of scope | §2 D-12, §4.2, §7 |
| D-13 | 2026-09-08 | Weekend days Sat/Sun confirmed; no company-settings admin API in D | §2 D-13, §3.1a, §7 |
| D-14 | 2026-09-08 | `public_holidays` from Cabinet Resolution 27/2024; lunar dates `PROVISIONAL`; narrow holiday admin only | §2 D-14, §3.1b |
| D-15 | 2026-09-08 | Month-end = calendar month-end (QuickBooks/Xero); no periods-admin / auto-period job in D | §2 D-15, §4.5a |
| D-16 | 2026-09-10 | ECL + VAT-relief eligibility share C's existing 01:00 UTC `RecurringJournalSchedulerService` cron — no second scheduler | §2 D-16, §4.5a–§4.5b |
| D-17 | 2026-09-10 | Late `debtor_notified_at` via `PATCH /invoices/:id/debtor-notified` after write-off | §2 D-17, §4.4 |