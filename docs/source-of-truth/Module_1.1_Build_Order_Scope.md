# inFINity — Module 1.1 Build Order & Scope Document

Companion to `feature-spec.md` (Module 1.1.A). Module 1.1.A (Double-Entry
Accounting Engine) is complete and signed off as of decision #59 — zero
open integrity gaps, hard-close/reopen excepted (deliberate stub, not a
gap). This document scopes what comes next, in what order, and why.

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
| 0 | Double-Entry Accounting Engine | A | — | ✅ Done (#1–#59) |
| 1 | Core Financial Reports | H (partial — see §1) | 0 | Next |
| 2 | Quotations & Tax Invoicing | C | 0 | Queued |
| 3 | Accounts Receivable | D | 0, 2 | Queued |
| 4 | Accounts Payable | E | 0, (3's mirror — see §4 open question) | Queued |
| 5 | AI Document Processing & OCR | B | 0, 4 | Queued |
| 6 | UAE VAT Compliance Engine | F | 0, 2, 4, 1 | Queued |
| 7 | UAE Corporate Tax Add-On | G | 0, 1, 6 | Queued |
| 8 | Extended Financial Reports | H (remainder — see §8) | 2, 3, 4, 6, 7 | Last |

---

## 1. Core Financial Reports (H, partial)

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

**Why third, not bundled with C:** D's features (aged receivables, credit
limits, customer statements, payment application) are meaningfully
separate concerns from invoice creation itself, and D needs C's invoices
to exist as real data before AR reporting means anything. Bundling them
would make C's PR too large and blur which module owns which rule.

**Depends on:** Module 0, Module 2 (C).

**Note for scoping:** "Write-off: bad debt write-off with VAT bad debt
relief calculation (after 6 months per FTA)" straddles D and F — decide
during D's scoping whether the write-off *action* lives in D (posts the
journal entry, updates customer ledger) while the *VAT relief calculation
rule* is deferred to F, or whether this needs to wait until F exists.
Recommend the former — post the write-off now with a placeholder/manual
VAT adjustment, wire the automatic 6-month VAT relief calculation into F
when it's built — rather than blocking D on F's existence.

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

1. Write `feature-spec.md` for **Module 1.1.H1 (Core Financial Reports)**
   — P&L, Balance Sheet, Trial Balance, General Ledger Report — matching
   the conventions of the 1.1.A spec (numbered sections, decision log,
   known-open-items table).
2. In parallel or immediately after: resolve the **Bill entity design
   question (§4)** as its own short decision document, even though E
   isn't next in line — it affects how B is scoped later, and it's the
   one open question in this whole build order that's cheaper to answer
   now than to discover mid-build.
