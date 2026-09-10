# inFINity — Module 1.1 Build Order & Scope Document

Companion to `feature-spec.md` (Module 1.1.A), `feature-spec-1.1.H1.md`,
`feature-spec-1.1.C.md`, and `feature-spec-1_1_D.md`. Module 1.1.A
(Double-Entry Accounting Engine) is complete and signed off as of
decision #63. Module 1.1.H1 (Core Financial Reports) is complete and
signed off as of H1 decision #6 (2026-08-30). Module 1.1.C **C1 core**
(customers, quotations, tax invoices, credit notes, ledger posting,
scheduled transitions) is complete as of C Batch 2 (2026-09-01).
Module 1.1.D (Accounts Receivable) is complete and signed off as of
D-1…D-17 (2026-09-10) — see §2 for C gaps D closed, §3 for D's
intentional deferrals to F / H-remainder / later admin work. This
document scopes what comes next, in what order, and why.

**Source:** `inFINity Complete Phase-Wise Feature List — All Modules &
Sub-Features` (July 2026), sections B–H, mapped against what Module 1.1.A
already provides.

**How to use this document:** it's a sequencing and dependency map, not a
feature spec. Each module gets its own `feature-spec.md`-style document
(schema, rules, decision log) when its turn comes — this doc exists so
that work doesn't start on a module whose dependencies aren't built yet,
and so open questions get resolved before they're discovered mid-build.

---

## Build order

| # | Module | Feature-list ref | Depends on | Status |
|---|---|---|---|---|
| 0 | Double-Entry Accounting Engine | A | — | ✅ Done (#1–#63) — `feature-spec.md` |
| 1 | Core Financial Reports | H (partial — see §1) | 0 | ✅ Done (H1 #1–#6, 2026-08-30) — `feature-spec-1.1.H1.md` |
| 2 | Quotations & Tax Invoicing | C | 0 | ✅ **C1 core done** (Batch 1–2, 2026-09-01) — `feature-spec-1.1.C.md`; §9 presentation + FTA gap register still deferred (→ post-C1/F); payment/`written_off` ledger closed by D (2026-09-10) |
| 3 | Accounts Receivable | D | 0, 2 | ✅ **Done** (D-1…D-17, 2026-09-10) — `feature-spec-1_1_D.md`; §7 deferrals → F / H-remainder / later admin |
| 4 | Accounts Payable | E | 0, (3's mirror — see §4 open question) | Queued |
| 5 | AI Document Processing & OCR | B | 0, 4 | Queued |
| 6 | UAE VAT Compliance Engine | F | 0, 2, 4, 1 | Queued |
| 7 | UAE Corporate Tax Add-On | G | 0, 1, 6 | Queued |
| 8 | Extended Financial Reports | H (remainder — see §8) | 2, 3, 4, 6, 7 | Last |

**Verification posture (2026-09-10, Module D sign-off):** full
`schema.sql` fresh-DB apply on Testing 1.1.A passed clean (+ COA seed +
UAE public-holidays seed); all `apply_*.sql` idempotent ×2; Jest
**573 passed** / 59 suites green (1 suite TS compile gap in
`journal-entries.service.spec.ts` mock — see `feature-spec-1_1_D.md` §8);
prior C baseline was **544/544** (2026-09-01).

---

## 1. Core Financial Reports (H, partial)

**Status: ✅ Complete (2026-08-30).** Spec: `feature-spec-1.1.H1.md`
(decisions #1–#6). Delivered: period Trial Balance, as-of Balance Sheet,
single-period P&L, General Ledger line listing, cross-report integrity
sweep (H1-5 passed clean; surfaced and fixed Module 1.1.A YE aggregation
bug #61). Nest routes: `GET /reports/trial-balance`, `/balance-sheet`,
`/profit-and-loss`, `/general-ledger`. Deferred to step 8 / H remainder:
prior-period comparison, GL pagination, cash flow, aged AR/AP, exports,
scheduled delivery — see H1 Known open items table.

**Scope for this pass:** P&L Statement, Balance Sheet, Trial Balance,
General Ledger Report — the four statements that are pure read-queries
over what Module 1.1.A already has (`journal_lines`, `accounts`,
`v_trial_balance`).

**Explicitly deferred to step 8:** Statement of Cash Flows (needs
categorization logic not yet designed — direct/indirect method), Aged
Receivables/Payables (need D/E), Sales by customer/product/salesperson
(needs C/D), Expense analysis trends, Executive summary, Comparative
periods, Custom date range, Export (PDF/XLSX/CSV), Scheduled delivery,
Accountant share link, Audit-ready pack. All of these either aggregate
across not-yet-built modules or are presentation/delivery features that
should wrap a stable reporting core rather than be built alongside it.

**Why first, ahead of any new transactional module:** this is the
strongest possible end-to-end validation that Module 1.1.A's engine
actually works, not just that its unit/integration tests pass. A Balance
Sheet that stays balanced through a reversal (TC12) and correctly reflects
a year-end close (TC11) is a different, stronger kind of proof than a
green test suite. It also requires zero new domain modeling — no new
tables, no new entities — so it's low-risk and fast, and gives every
later module a working reporting surface to build against instead of
each one inventing its own ad hoc balance-checking along the way.

**No open questions.**

---

## 2. Quotations & Tax Invoicing (C)

**Status: ✅ C1 core complete (2026-09-01).** Spec: `feature-spec-1.1.C.md`
(decisions #1–#23). **Batch 1 (2026-08-31):** C1-1 customers, C1-2
quotations, C1-3 tax invoices, C1-4 credit notes, C1-5 quotation→invoice
convert. **Batch 2 (2026-09-01):** invoice/credit-note ledger posting at
Issue, void auto-reversals, quotation `Expired` + invoice `Overdue`
scheduled transitions (shared 01:00 UTC cron with recurring generation).
Fresh-DB discipline: `schema.sql` top-to-bottom + `seed_finalized_coa_demo_company_0002.sql`.

**Still open within / after C1** (authoritative list: feature-spec-1.1.C.md §10):

| Gap | Owner |
|---|---|
| Invoice `partially_paid` / `paid` + payment application | ✅ **Closed by Module D** (2026-09-10) — `payment_applications` + `amount_paid`/`paid_at` triggers |
| Invoice write-off ledger posting | ✅ **Closed by Module D** (2026-09-10) — `create_invoice_write_off` + Nest write-off / debtor-notified |
| FTA 6-month VAT bad-debt **relief filing / reclaim** (VAT-201) | Module F — D only flags `write_offs.vat_relief_eligible` (§4.5b); does not file |
| §9 presentation/delivery (PDF, WhatsApp, bilingual, reminders, recurring invoices, proforma behavior, cloning) | Post-C1 |
| FTA sequential numbering gap detection / immutable audit register | Post-C1 / F |
| Product/service catalog → default income-account mapping | Unscoped follow-up |

**Why second:** this is the primary revenue-transaction engine. Nearly
everything downstream depends on it existing first — Accounts Receivable
(D) is largely a set of views/aggregations *over* invoices and payments
this module creates; half of the VAT engine (F) needs output tax figures
that only exist once invoices exist.

**Depends on:** Module 0 only (accounts, journal posting). Does not
depend on D, E, F, or B — quotations and invoices should be postable to
the ledger on their own before any of those exist.

**Note for scoping:** this module introduces the FTA-compliance surface
area for the first time (TRN fields, sequential numbering with gap
detection, tax-invoice vs. simplified-tax-invoice threshold logic). Worth
treating those FTA-specific rules with the same rigor Module 1.1.A gave
UAE-specific accounting rules (Zakat, Import Duty) — i.e., get the exact
threshold/format rules right and decision-logged, not assumed.

---

## 3. Accounts Receivable (D)

**Status: ✅ Complete (2026-09-10).** Spec: `feature-spec-1_1_D.md`
(decisions D-1…D-17). Delivered: payments + applications into
`partially_paid`/`paid`, advances (`2060`), write-off ledger posting,
ECL provisioning + VAT-relief *eligibility* flag, public holidays +
business-day helper, aged AR / customer ledger / credit-limit alert /
statement **data** / payment history. Nest routes under payments,
invoices (write-off + debtor-notified), public-holidays, and reports.

**Why third, not bundled with C:** D's features (aged receivables, credit
limits, customer statements, payment application) are meaningfully
separate concerns from invoice creation itself, and D needs C's invoices
to exist as real data before AR reporting means anything. Bundling them
would make C's PR too large and blur which module owns which rule.

**Depends on:** Module 0, Module 2 (C).

**Write-off vs VAT relief (resolved as recommended):** D posts the
write-off journal and tracks `debtor_notified_at` /
`vat_relief_eligible`; Module F owns VAT-201 filing/reclaim of the
6-month FTA bad-debt relief.

### Deliberate deferrals from D (tracked, not lost)

Authoritative detail: `feature-spec-1_1_D.md` §7. Carry-forward:

| Item | Owner |
|---|---|
| `1070 → 1020` settlement/clearing entries (card/POS clearing) | Later / bank-reconciliation module — manual JE until then (D-12) |
| VAT-201 return filing / bad-debt reclaim mechanics | Module F |
| PDF / XLSX / CSV export mechanics (incl. statement PDF) | H-remainder (Build Order §8); D ships statement **data** only |
| Automated dunning / reminder delivery | Post-C1 presentation (same bucket as C §9) |
| Multi-currency payments or advances | Unscoped until raised explicitly |
| Company-settings admin API (`weekend_days`, thresholds, `default_bank_account_id`) | Later company-admin module — D-13; D reads settings, does not write them (exception: narrow `public_holidays` admin per D-14) |

---

## 4. Accounts Payable (E)

**Why fourth:** structurally mirrors D on the purchase side, and should
follow the same "get the ledger-facing transaction module built, then
its reporting/management layer" pattern established by C→D.

**Depends on:** Module 0. Does **not** strictly depend on D — E is D's
mirror, not D's dependent — but is sequenced after D so the two share a
consistent pattern (customer ledger / supplier ledger; aged receivables /
aged payables) rather than being designed independently and drifting.

### ⚠️ Open question to resolve before scoping E — do not defer to mid-build

**There is no "Bill" entity defined anywhere in the source feature list
or in Module 1.1.A's schema.** D's AR side has a clear source: bills-owed
data comes from C's invoices, which already have a real table. E's AP
side (`supplier ledger`, `aged payables`, `duplicate bill detection`,
`three-way match: PO vs delivery note vs supplier invoice`) all
presuppose a Bill entity with its own fields — PO reference, delivery
note reference, supplier invoice number, due date — that doesn't exist
yet.

This needs a decision, in the same style as Module 1.1.A's decision log,
**before** E's feature-spec doc is written:

- **Option A:** a Bill is its own table (`bills`), parallel to how
  `journal_entries` and `accounts` are separate concerns, with its own
  lifecycle (draft → matched → approved → posted) and its own journal
  linkage once posted — similar in spirit to how `recurring_journal_templates`
  generates `journal_entries` rather than being one itself.
- **Option B:** a Bill is a `journal_entries` row with `entry_type`
  extended to include something like `'supplier_bill'`, with
  AP-specific fields either folded into existing columns or added via a
  side table for the fields journal_entries has no room for (PO
  reference, delivery note, three-way-match status).

Recommend Option A — the three-way match and duplicate-detection features
need a pre-posting lifecycle (a bill can exist, be matched, be disputed,
all before it's ever a journal entry), which doesn't fit naturally into
`journal_entries`' existing draft→posted model built around Module 1.1.A's
simpler manual-entry assumptions. But this is a real design decision, not
a formality — resolve it explicitly, log it, before starting E.

**This same entity also feeds Module 5 (B — OCR)**, since OCR-extracted
supplier invoices need a landing target. Resolving the Bill entity design
here, before B is scoped, avoids B guessing at a schema that doesn't
exist yet and having to be reworked once E defines it properly.

---

## 5. AI Document Processing & OCR (B)

**Why fifth, not earlier:** despite being listed first (B) in the source
feature document, this is an *intake automation layer*, not a standalone
module. Every one of its outputs — extracted invoice, extracted bill,
extracted bank statement transaction — needs a structural target to land
in. Building OCR before Accounts Payable's Bill entity (§4) exists means
building against a guess, not a real schema, and very likely means
reworking it once E is actually built.

**Depends on:** Module 0 (to post the eventual journal entries), Module 4
(E — the Bill entity OCR extraction targets, per §4's open question).

**Note for scoping:** "Batch upload: process up to 50 documents
simultaneously in background queue (BullMQ)" is the first mention of a
queue/worker infrastructure requirement anywhere in this build order —
confirm BullMQ (or equivalent) is actually provisioned in the
environment before scoping this module's timeline, since it's new
infrastructure, not just new application code on top of the existing
Nest/Supabase stack.

**Note on scope-splitting:** this module bundles genuinely different
capabilities — document OCR (invoices/receipts), bank statement PDF
parsing, and email inbox monitoring (Gmail/Outlook integration) are three
different technical problems wearing one feature-list letter. Recommend
splitting into sub-phases (B1 document OCR, B2 bank statement import, B3
email capture) with their own scoping, rather than one monolithic spec —
matching how Module 1.1.A itself was scoped as "1.1.A" specifically, with
1.1.B–H reserved as separate documents from the start.

---

## 6. UAE VAT Compliance Engine (F)

**Why sixth:** VAT 201 auto-calculation needs output tax data (from C's
invoices), input tax data (from E's bills), and reconciles to the general
ledger via the reporting core (Module 1). Building F before any of those
three exist means there's no real data to calculate VAT from.

**Depends on:** Module 0, Module 2 (C), Module 4 (E), Module 1 (H-core).

**Note for scoping:** this is the highest-compliance-risk module in the
list — "5-year immutable record," FTA audit pack, sequential invoice
register with gap detection, and the eventual "Direct FTA e-filing API"
all require the same level of rigor Module 1.1.A applied to immutability
(§3's audit trail, §5.1's backend-mediated access) — worth treating as
its own audit-sweep candidate (a "§7.16-style" pass) before sign-off,
not just a standard test suite.

---

## 7. UAE Corporate Tax Add-On (G)

**Why last of the compliance modules:** CT provision auto-posting needs
an accurate, complete P&L across a full fiscal year (Module 1) and hooks
directly into Module 0's existing year-end closing RPC
(`create_year_end_closing_entry`, feature-spec.md §4.4/§6) — CT provision
should almost certainly be inserted into that existing closing flow
rather than becoming a second, parallel closing mechanism. It also
benefits from F existing first, since "Free zone income classifier"
overlaps conceptually with F's zero-rated/exempt VAT categorization work.

**Depends on:** Module 0 (specifically the year-end closing RPC), Module
1 (H-core, for the running P&L the threshold tracker needs), Module 6 (F,
for the free-zone/exempt categorization pattern).

**Note for scoping:** decide explicitly whether CT provision posting
extends `create_year_end_closing_entry` (adding a CT line alongside the
existing Retained-Earnings transfer) or is a wholly separate RPC that
runs after it. Given Module 1.1.A's stated preference for DB-level
enforcement of one-time-per-fiscal-year rules (decision #4, the
`YEAR_END_ALREADY_CLOSED` token), a separate `create_ct_provision_entry`
RPC with its own advisory-lock namespace (following the `ob:`/`ye:`
convention from §6) is likely the better fit — don't extend the existing
RPC and risk coupling CT logic into a function that predates CT's
existence.

---

## 8. Extended Financial Reports (H, remainder)

**Why last:** every deferred item from §1 needs a module that doesn't
exist until this point — Statement of Cash Flows needs enough
transaction volume/categorization from C–G to be meaningful; Aged
Receivables/Payables need D/E directly; Sales by customer/salesperson
needs C/D; Expense analysis needs a real transaction history across
modules; Accountant share link and scheduled delivery are
delivery-mechanism features that should wrap an already-stable reporting
layer rather than be built speculatively early.

**Depends on:** Modules 2, 3, 4, 6, 7 (effectively everything).

---

## Summary — what to do right now

**Completed since this doc was first written:**

- ✅ **Module 1.1.H1** — `feature-spec-1.1.H1.md` written, built, and
  signed off (#1–#6, 2026-08-30).
- ✅ **Module 1.1.C C1 core** — `feature-spec-1.1.C.md` written; Batch 1
  (C1-1…C1-5) landed 2026-08-31; Batch 2 (ledger + scheduler) landed
  2026-09-01; fresh-DB apply verified 2026-09-01.
- ✅ **Module 1.1.D** — `feature-spec-1_1_D.md` written and built
  (D-1…D-17, 2026-09-10); fresh-DB + idempotent `apply_*.sql` + Jest
  **573** verified per §8 of that spec. Carry-forward deferrals listed
  in §3 above / feature-spec §7.

**Next:**

1. Resolve the **Bill entity design question (§4)** as its own short
   decision document — it affects how B is scoped later, and it's the
   one open question in this build order that's cheaper to answer now
   than to discover mid-build.
2. Scope **Module 1.1.E (Accounts Payable)** when ready — mirror D's
   pattern; do not invent a divergent subledger shape.
3. **Post-C1 / post-D carry-forward** (not blocking E): FTA gap-detection
   register, C §9 presentation features, D §7 items (1070→1020
   settlement, VAT-201 filing in F, PDF/export, dunning, multi-currency,
   company-settings admin API) — track in the owning module's
   feature-spec until explicitly scoped.
4. Optional hygiene: close the D-P13 `journal-entries.service.spec.ts`
   mock gap so the suite is fully green.
