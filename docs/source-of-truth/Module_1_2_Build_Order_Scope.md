# inFINity — Module 1.2 Build Order & Scope Document

Companion to `Module_1_1_Build_Order_Scope.md` (Module 1.1: accounting
engine, core + extended reports, quotations/invoicing, AR, AP, VAT, Corporate
Tax). Module 1.1 built set is the foundation this module sits on:
`feature-spec.md` (1.1.A), `feature-spec-1_1_C.md`, `feature-spec-1_1_D.md`,
`feature-spec-1_1_E.md`, `feature-spec-1_1_F.md`, `feature-spec-1_1_G.md`,
`feature-spec-1_1_H.md`. **Nothing in Module 1.2 is built or specced yet —
every status below is Queued.** Module 1.1.B is no longer entirely queued:
B1 (document OCR → `bill_extraction_meta`) is in the API; B2 (bank-statement
PDF) and B3 (email capture) are not. B2's landing target is this module's
staging table (§1), which is not in `schema.sql` yet.
This document scopes what Module 1.2 contains, in what order, and why.

**Source:** `inFINity Complete Phase-Wise Feature List — Module 1.2 · Bank
Accounts & Reconciliation`, sections A–D (as supplied 2026-10-07), mapped
against what Module 1.1 already provides.

**How to use this document:** it's a sequencing and dependency map, not a
feature spec. Each lettered module gets its own `feature-spec-1_2_X.md`
(schema, rules, decision log) when its turn comes — this doc exists so that
work doesn't start on a module whose dependencies aren't built yet, and so
open questions (§8) get resolved before they're discovered mid-build.

**Section map (source → this doc):**

| Source section | Content | Where scoped |
|---|---|---|
| A | UAE Open Banking Integration (Lean API) | §1 (A1: accounts + manual import), §3 (A2: Lean live feed) |
| B | Bank Reconciliation Engine | §2 (B1: deterministic core), §4 (B2: AI layer) |
| C | Historical Data Import | §5 (C1: bank history + opening balances), §6 (C2: migration wizards) |
| D | Petty Cash Management | §7 |

---

## Build order

| # | Module | Feature-list ref | Depends on | Status |
|---|---|---|---|---|
| 1 | Bank Accounts & Manual Statement Import (CSV / OFX) | A (partial — see §1) | 1.1.A | Queued |
| 2 | Bank Reconciliation Engine — deterministic core | B (partial — see §2) | 1, 1.1.A, 1.1.D, 1.1.E | Queued |
| 3 | Lean Open Banking Live Feed | A (remainder — see §3) | 1, 2 | Queued — **start Lean onboarding early** (§3) |
| 4 | AI Matching Layer (fuzzy match + bulk confirm) | B (remainder — see §4) | 2 | Queued |
| 5 | Historical Import — bank history, opening balances, AI categorisation | C (partial — see §5) | 1, 2, (4 for shared AI infra) | Queued |
| 6 | Migration Wizards (QuickBooks/Xero, Tally/Zoho, Excel) | C (remainder — see §6) | 1.1.A, 5 | Queued |
| 7 | Petty Cash Management | D | 1.1.A | Queued — independent, can run parallel to 1–6 |

**Spec packaging (follows the H1 core + H2 extended precedent):** one spec
per lettered module with Part I / Part II where a module is split —
`feature-spec-1_2_A.md` (A1 + A2), `feature-spec-1_2_B.md` (B1 + B2),
`feature-spec-1_2_C.md` (C1 + C2), `feature-spec-1_2_D.md`.

---

## 0. What Module 1.1 already gives Module 1.2 (grounding)

Carried from the 1.1 build order — these are facts to build against, not
things to re-decide:

| Fact | Source | Consequence for 1.2 |
|---|---|---|
| `1070 → 1020` settlement / clearing entries (card/POS clearing) were deferred to "Later / bank-reconciliation module"; manual JE until then | 1.1 §3 / D-12 | **This module owns it.** Must be explicitly scoped in B1, not discovered later |
| Customer payments post to the ledger (D); supplier payments, runs and advances post to the ledger (E) | 1.1 §3, §4 | These ledger-side bank movements are what reconciliation matches *against* — bank lines for already-recorded payments must match, never double-post (Q1) |
| `default_bank_account_id` is a company setting D reads but does not write; company-settings admin API is deferred | 1.1 §3 / D-13 | A1 introduces real bank-account records; decide whether A1 owns this setting's admin or stays read-only (Q2) |
| Year-end close RPC and period-based reporting (`period_id`) exist; year-end close gates on CT provision unless Owner skip | 1.1 §1, §7 / G-22 | Reconciliation lock must be defined relative to accounting-period close, not independently (Q5) |
| Owner-override-with-reason pattern exists (E-25 payment on failed match; G-22 CT skip) | 1.1 §4, §7 | Reuse for reconciliation re-open — Owner only, reason mandatory, audit-logged |
| `journal_approval_threshold` gate (E-28, AED 50,000 for bills) | 1.1 §4 | Postings created from reconciliation (categorise-from-unmatched) must respect the same approval gate |
| Shared 01:00 UTC cron (recurring generation + scheduled transitions) | 1.1 §2 | Candidate for the daily pull scheduler — but see queue note in §3 |
| No mailer exists (H-R14 deferred for that reason) | 1.1 §8 | Lean consent-expiry / reconnect notices have no delivery channel yet |
| Guarded HTTP inventory is 225 routes (`controller-auth-coverage.spec.ts`) | 1.1 §8, updated after B1 | Every new 1.2 route goes through the same guard; inventory count updates per module |
| Supplier *statement* reconciliation already exists under E | 1.1 §4 | **Different feature** from bank reconciliation — keep naming distinct in schema and routes to avoid collision |

## 0.1 Schema check — 2026-10-07

Checked against `docs/source-of-truth/schema.sql` and the demo COA seed
`seed_finalized_coa_demo_company_0002.sql`. These are facts. They do not
close Q1, Q3–Q6, Q8, or Q9.

| Topic | What exists | What does not exist |
|---|---|---|
| Bank-account register | COA accounts only. `1020` Bank Account - Current (AED), children `1021` Operations and `1022` Payroll (depth 2, parent `1020`). Also `1030` Savings (AED), `1040` Foreign Currency (USD, active), `1050` Foreign Currency (EUR, **inactive**), `1060` Undeposited Funds / Cash in Transit, `1070` Merchant / Payment Gateway Clearing, `1820` Long-term Bank Deposits. `account_number` is `char(4)` — no `1020.1`. | No `bank_accounts` table, no IBAN, no statement balance, no per-account currency column. A second bank today is another COA account (D-12), not a bank-account row. |
| Credit cards | Nothing named credit card in the COA. Closest liabilities: `2500`/`2510` bank loan, `2520` Overdraft Facility (active). | No credit-card liability account. Q2 cannot be answered "use account N" — there is no N. |
| Default bank | `company_settings.default_bank_account_id` → `accounts(id)`, seeded to `1020`. One value per company. No settings write API (D-13). | A1 does not yet own admin of this column. Q2's "does A1 own the admin API?" is still a decision, not a schema fact. |
| Cash already posted | `payments.bank_account_id` and `supplier_payments.bank_account_id` (nullable FK to `accounts`). Method enum: `cash`, `bank_transfer`, `cheque`, `card`, `pos`, `other`. Routing: cash → `1010`; card/POS → `1070`; transfer/cheque/other → `default_bank_account_id` else `1020`. `1070 → 1020` settlement is still not a function. | No link from a bank line to a payment. Matching that link is Q1. |
| Cheques (Q7) | `payment_method = 'cheque'` only. `payments.reference_number` and `supplier_payments.reference_number` are free text. | No cheque number, cheque date, or post-dated flag on either payment table. An outstanding-cheques register cannot be built from existing columns. |
| Outstanding deposits | `1060` Undeposited Funds / Cash in Transit exists as a COA account. | No deposits-in-transit register. |
| Opening balance | `create_opening_balance_entry`: one `opening_balance` journal per company per fiscal year, balance-sheet accounts only, requires an open period. Raises `OPENING_BALANCE_ALREADY_EXISTS`. | Not per bank account. A bank opening position is not a separate mechanism. |
| Period lock (Q5 inputs) | `accounting_periods.status`: `open`, `soft_closed`, `closed`. `reopen_reason`, `reopened_by`, `reopened_at`. `company_settings.allow_period_reopen` default true. | No reconciliation-lock table. How a bank-rec lock relates to period close is still Q5. |
| Approval gate | `journal_entries.requires_approval`. `resolveApprovalThreshold` applies `journal_approval_threshold` to ordinary journals (null = off). E-28 applies that threshold at bill Issue. Write-off uses `write_off_approval_threshold`. | No reconciliation entry type in `journal_entry_type`. |
| Name collision | `supplier_statement_lines` + `reconcile_supplier_statement`. `reconcile_vat_return`. | Neither is bank reconciliation. Do not reuse those names. |
| OCR B2 landing | `bill_extraction_meta` stores a bill file and `extracted_snapshot`. Provider on the single-document path is OCR.space (raw text in `ocr_text`). Veryfi is unused on that path. | That table is bill-shaped (`bill_id`). Bank-statement lines have nowhere to land. BullMQ code exists; batch stays off unless `REDIS_URL` and `DOCUMENT_OCR_BATCH_ENABLED=true`. |
| Petty cash (Q10, COA only) | `1000` Petty Cash, asset, Cash & Bank, active, depth 1. One account, not one per fund. | No fund, voucher, or cash-count table. VAT-on-voucher into F is still Q10. |
| Currency (Q11 inputs) | `companies.base_currency` default `AED`. Money columns are `numeric(18,2)` AED unless a spec says otherwise. `1040` USD is an active AED-ledger account, not a foreign-currency subledger. | No FX rate table, no transaction currency on `journal_lines`. Whether 1.2 is AED-only is still Q11. |

---

## 1. Bank Accounts & Manual Statement Import (A, partial)

**Status: Queued.** Spec: `feature-spec-1_2_A.md` Part I (A1) — not yet written.

**Scope for this pass:**

- Multi-account: unlimited bank accounts **and** credit card accounts
  simultaneously
- Manual import fallback: CSV and OFX
- Bank statement staging: imported lines land in a staging table with
  source, import batch and dedupe key — the single landing target every
  later feed (Lean, historical import, and eventually OCR B2) writes into
- Book balance vs bank balance side by side — in A1 the "bank balance" is the
  last imported statement closing balance; the *real-time* balance arrives
  with §3
- Opening balance per bank account (minimum manual field — the guided
  wizard is §5; reconciliation cannot start without a reconciled opening
  position)

**Why first:** every other piece of this module — reconciliation, live feed,
historical import — needs bank-account records and a bank-transaction
staging table to exist. Building the manual path first also means the
reconciliation engine (§2) is validated against deterministic CSV/OFX
fixtures before any external API is in the loop.

**Depends on:** Module 1.1.A (COA accounts, journal posting). Bank accounts
map to COA accounts. Schema check (§0.1): `1020` is the seeded default;
`1021`/`1022` are children of it; there is no credit-card liability in the
seed. Q2 (one COA account per bank account, and whether A1 writes
`default_bank_account_id`) is still open.

**Note for scoping:**

- **Staging-table design is the load-bearing decision of the whole module.**
  Like E-1's Bill entity for OCR, it is the landing target for four
  different producers (CSV/OFX, Lean, historical bulk, OCR B2). Decide the
  shape once, here, with dedupe (re-importing an overlapping statement must
  not create duplicates).
- OFX and CSV are different problems: OFX is structured (has FITID for
  dedupe); CSV is per-bank column mapping. Expect a saved
  "column-mapping profile per bank" concept for CSV.
- Credit-card accounts have inverted sign conventions (a charge is a
  credit to the liability) — get sign handling right and decision-logged,
  same rigor as 1.1.A's UAE-specific accounting rules.

---

## 2. Bank Reconciliation Engine — deterministic core (B, partial)

**Status: Queued.** Spec: `feature-spec-1_2_B.md` Part I (B1) — not yet written.

**Scope for this pass:**

- Three-column reconciliation view: bank statement | unreconciled ledger |
  matched items
- Auto-matching: amount + date (3-day tolerance) + description similarity
  scoring (rules-based; no AI model in this pass)
- Manual matching: drag-and-drop unmatched items to pair them
- Split matching: one bank transaction matched across multiple ledger
  entries
- Unmatched items queue: bank transactions with no ledger match —
  categorise directly (creates a ledger entry; see Q1)
- Outstanding cheques register: cheques issued but not yet cleared
- Outstanding deposits register: deposits in transit not yet cleared
- Reconciliation lock: completed periods cannot be re-opened without Owner
  permission
- Reconciliation report: printable FTA-ready bank reconciliation statement
- **Inherited from D-12:** `1070 → 1020` card/POS clearing settlement entries

**Why second:** it is the core value of the module and the strongest
validation of 1.1's ledger — a reconciliation that closes to zero against
payments posted by D and E is the same kind of end-to-end proof H1's Balance
Sheet was for 1.1.A, a stronger check than a green test suite.

**Depends on:** Module 1 (staging table, bank accounts), Module 1.1.A,
Module 1.1.D (customer payments = deposits side), Module 1.1.E (supplier
payments = cheques/transfers side).

**Note for scoping:**

- **Two accounting models are both implied by the feature list** — ledger-first
  (traditional: match bank lines to existing ledger entries) and
  feed-first (categorise a bank line and post it). "Unmatched queue —
  categorise directly" is the feed-first half. The two must be reconciled in
  one rule set or customers' payments get posted twice (once from D/E, once
  from the bank line). **Resolve as Q1 before B1 spec.**
- Scoring is a deterministic, explainable function (amount exact / date
  delta / description similarity). Store the score and the reason per
  suggested match — B2 and any audit depend on being able to answer "why was
  this matched".
- Split matching and partial clears need an explicit rule on tolerance and
  residual (does an AED 0.01 rounding difference auto-close?) — decision-log
  it.
- "FTA-ready" is not self-defining. Pin down the required layout/fields
  (statement date, bank vs book balance, outstanding items, preparer/
  reviewer sign-off) in the spec, with the same discipline as Module F's
  FTA rules, rather than assuming (Q8).
- Cheque mechanics: schema check (§0.1) — they do not. `payment_method`
  can be `cheque`; there is no cheque number, cheque date, or post-dated
  flag. The registers need new columns. That is still Q7 as a design
  choice (which columns, on the payment or on the bank line), not as a
  lookup.

---

## 3. Lean Open Banking Live Feed (A, remainder)

**Status: Queued.** Spec: `feature-spec-1_2_A.md` Part II (A2) — not yet written.

**Scope for this pass:**

- Live bank connection: Emirates NBD, FAB, ADCB, Mashreq, RAK Bank, DIB, CBD
- Daily automatic transaction pull — no manual export required
- Real-time bank balance alongside accounting book balance, side by side
  (upgrades A1's last-statement balance)
- CSV/OFX remains the permanent fallback for banks not on Lean

**Why after reconciliation, not before:** Lean is just another *producer*
into the staging table from §1. Reconciliation doesn't care where a bank
line came from, so B1 can be built and proven on manual files while the
external dependency matures.

**Start the non-engineering track early:** Lean onboarding (commercial
agreement, sandbox access, production approval) has lead time that code
doesn't. Begin it during §1/§2 even though the build lands at #3.

**Depends on:** Module 1 (accounts + staging), Module 2 (so live data lands
in a working reconciliation flow).

**Note for scoping:**

- **New infrastructure, not just application code.** Third-party consent
  and token lifecycle (store, refresh, expiry, revoke), secret storage,
  per-connection retry and backoff, and webhook or polling handling. Confirm
  the environment can hold bank credentials/tokens safely before scoping the
  timeline.
- **Scheduler:** the shared 01:00 UTC cron exists, but a per-connection pull
  with retries is a queue-shaped problem. As with Module B's batch OCR, **BullMQ
  (or equivalent) is not confirmed as provisioned** — confirm before
  estimating.
- **Coverage is an assumption until verified.** The seven named banks are
  the product promise; each needs to be checked against Lean's current
  coverage, data scope (balances, transaction history depth), and consent
  duration. Any bank not covered falls back to §1 import (Q3).
- Consent expiry needs a user-facing reconnect flow; there is no mailer (H-R14),
  so in-app notification is the only channel until one exists.
- Pull idempotency: a retried or overlapping pull must not duplicate
  lines — rely on the §1 dedupe key.
- Data-residency and bank-data handling obligations for UAE financial data
  need to be confirmed, not assumed (Q3).

---

## 4. AI Matching Layer (B, remainder)

**Status: Queued.** Spec: `feature-spec-1_2_B.md` Part II (B2) — not yet written.

**Scope for this pass:**

- AI fuzzy matching: identifies likely matches where descriptions differ
  between bank and ledger
- Bulk confirm: approve all AI-suggested matches with a single click

**Why separate from B1:** B1 is deterministic and fully testable. B2 adds a
model, which brings nondeterminism, cost, data-handling questions and a
confirmation-risk surface (one click approving many matches). Keeping it
separate means B1 ships and is signed off without waiting on any of that.

**Depends on:** Module 2 (B1) — B2 only *suggests* over B1's matching
model; it never bypasses it.

**Note for scoping:**

- **AI suggests, a human (or an explicit rule) confirms.** Nothing in B2
  posts or matches silently. This preserves 1.1.A's immutability and audit
  posture.
- Persist per suggestion: confidence score, model/version, inputs used,
  who confirmed and when. Same "why" trail B1 requires.
- **Bulk confirm needs guardrails**: show confidence, let the user filter by
  confidence band, and consider excluding low-confidence or split/large-value
  suggestions from the single-click path (Q4, Q9).
- Provider, cost model and what transaction text is sent out of the
  environment are open (Q9). This is also the first of two AI features in the
  module (see §5) — share infrastructure and a prompt/eval approach rather
  than building twice.
- Define an accuracy bar before sign-off (e.g. measured on a labelled set of
  real-looking bank/ledger pairs) rather than "looks good in demo".

---

## 5. Historical Import — bank history, opening balances, AI categorisation (C, partial)

**Status: Queued.** Spec: `feature-spec-1_2_C.md` Part I (C1) — not yet written.

**Scope for this pass:**

- Bulk bank statement import: up to 5 years of transaction history via CSV
- AI categorisation of historical transactions from description text
  patterns
- Opening balance wizard: guided step-by-step setup for new companies
- Historical import review: flag transactions that could not be
  auto-categorised

**Why after reconciliation:** bulk import reuses §1's staging/import
pipeline at scale and needs §2's rules to decide what is already
accounted for. The opening balance wizard needs bank accounts to exist.

**Depends on:** Module 1 (import pipeline, staging), Module 2 (matching
rules, so history isn't double-booked), Module 1.1.A (opening balance
journal), Module 4 for shared AI infrastructure (not a hard dependency).

**Note for scoping:**

- **Highest data-integrity risk in the module.** Five years of history
  intersects things 1.1 already locked: closed accounting periods, **VAT
  returns already filed (F)**, **Corporate Tax provisions already posted
  (G)**, and **FTA sequential numbering** for any invoice-like data. Importing
  into a closed or filed period must be an explicit, Owner-gated path with
  a decision-logged rule, or it is blocked (Q6).
- **Import-and-categorise creates ledger entries** (feed-first). For a
  company that already records invoices and payments in inFINity, those
  bank lines must *match* rather than post — this is Q1 again, at five-year
  scale. A dry-run / preview-before-commit step is strongly recommended.
- Batch size and runtime: a 5-year import is a background job. Same
  queue question as §3 and Module B.
- AI categorisation: deterministic rule patterns (learned payee → account
  mappings) should be tried before the model. Confidence below a threshold
  goes to the review queue, never auto-posts.
- The review queue is the safety valve — its UX and sign-off criteria
  (what counts as "done") should be specced, not left as a flag column.
- Opening balance wizard: reuse `create_opening_balance_entry` (§0.1).
  It is one balance-sheet journal per company per fiscal year, not a
  per-bank opening. A per-account opening is a new rule and is not in
  that RPC.

---

## 6. Migration Wizards (C, remainder)

**Status: Queued.** Spec: `feature-spec-1_2_C.md` Part II (C2) — not yet written.

**Scope for this pass:**

- QuickBooks / Xero data import: map and import existing chart of accounts
  and history
- Tally / Zoho Books migration wizard
- Excel spreadsheet import: for businesses currently managing accounts in
  Excel

**Why last of the import work, and why split from C1:** these are three
different technical problems wearing one feature-list letter — structured
third-party exports (QB/Xero), regional-product exports (Tally/Zoho), and
free-form spreadsheets. Same reasoning as Module B's recommended
B1/B2/B3 split. C1 delivers a usable onboarding path (bank history +
opening balances) without waiting on any of them.

**Depends on:** Module 1.1.A (COA, journals), Module 5 (import
pipeline, review queue, closed-period rules).

**Note for scoping:**

- **COA mapping is the hard part.** Imported accounts must map into the
  finalized 186-account COA (including the F-41 and G-24 accounts) —
  a mapping UI plus saved mappings per source system. Unmapped
  accounts need an explicit rule (create vs reject vs suspense).
- "History" for these sources goes well beyond bank lines — it can include
  invoices, bills, payments, contacts. That reaches Modules C/D/E and their
  numbering and VAT rules. **Recommend C2's first spec pass limit scope to
  COA + opening balances + journal-level history**, and treat invoice/bill/
  contact migration as a separately scoped follow-up unless the owner
  says otherwise (Q6).
- Source format stability: QuickBooks, Xero, Tally and Zoho exports change;
  pin the supported export versions/formats in the spec and keep fixtures.
- Excel import has no schema — needs a column-mapping step and strict
  validation with row-level error reporting.

---

## 7. Petty Cash Management (D)

**Status: Queued.** Spec: `feature-spec-1_2_D.md` — not yet written.

**Scope for this pass:**

- Petty cash fund: set opening balance, record receipts and top-ups
- Petty cash voucher: expense claim with receipt attachment
- Petty cash reconciliation: fund balance vs receipts vs cash on hand
- Multiple petty cash funds for different departments or locations

**Why independent:** petty cash needs only the ledger (Module 1.1.A) — no
bank feed, no staging table. It can be built in parallel with §1–§6 or slotted
whenever capacity allows. If built after §2, reuse reconciliation-lock and
variance-handling patterns rather than inventing new ones.

**Depends on:** Module 1.1.A only.

**Note for scoping:**

- Each fund maps to its own ledger account (or sub-account) so a
  fund's balance is a ledger balance, not a separate counter. Schema
  check (§0.1): `1000` Petty Cash exists, one active account, no child
  funds. Multiple funds are still Q10 (new `char(4)` accounts vs children
  of `1000`). VAT-on-voucher into F is still open.
- **VAT on vouchers.** Module F derives input VAT from E's bills (1.1 §6).
  Petty cash vouchers with VAT are a *new input-tax source*. Confirm
  how F's calculation reads input tax (ledger/tax codes vs bills only), and
  require a valid tax-invoice receipt before input VAT is reclaimable. Do not
  leave this to be discovered at VAT-201 time (Q10).
- Cash-on-hand count vs book balance produces a variance: decide the
  posting for shortage/overage (expense vs suspense) and who approves it.
- Receipt attachments: confirm where files are stored and the retention
  expectation — this overlaps the 5-year record requirement in F.
- Voucher approval: custodian vs approver separation, and whether
  `journal_approval_threshold` applies.
- Fund closure and transfer between funds / to bank should be modeled
  (top-up from bank is a bank-account movement and will itself appear on
  the §2 reconciliation).

---

## 8. Open questions (resolve before the owning module's spec)

| # | Question | Blocks | Why it matters |
|---|---|---|---|
| Q1 | **Feed-first vs ledger-first.** When a bank line corresponds to a payment already recorded via D/E, it must match — never re-post. When it has no ledger entry, categorising creates one. What single rule set governs both? | B1, C1 | Wrong answer double-counts cash. Highest-impact question in the module |
| Q2 | Bank / credit-card account ↔ COA mapping: one COA account per bank account? Which codes? Does A1 own `default_bank_account_id` admin (D-13)? **Schema (§0.1):** `1020` plus children `1021`/`1022`; `1030`, `1040`, `1060`, `1070` exist; no credit-card liability account exists; `default_bank_account_id` is one FK, no write API. | A1 | Schema shape; reconciliation balances come from these accounts |
| Q3 | Lean: verified coverage for the seven named banks, history depth, consent duration, pricing, sandbox access; data-residency and consent obligations for UAE bank data | A2 | Product promise vs reality; may change the fallback ratio |
| Q4 | Auto-match thresholds: is the 3-day tolerance fixed or per-company? Score thresholds for auto-confirm vs suggest? Rounding/residual tolerance? | B1, B2 | Defines false-match risk |
| Q5 | Reconciliation lock vs accounting-period close: same lock, a separate lock, or layered? What does Owner re-open do to later reconciled periods? | B1 | Interaction with year-end close and filed VAT/CT |
| Q6 | Historical import into closed periods / filed VAT returns / posted CT provisions; scope of "history" for QB/Xero/Tally/Zoho (journals only vs invoices, bills, contacts) | C1, C2 | FTA numbering and filed-return integrity |
| Q7 | Cheque data model. **Schema (§0.1): no.** Method `cheque` and free-text `reference_number` only. Outstanding cheques/deposits still need a design. `1060` exists for cash in transit but is not a register. | B1 | Outstanding cheques/deposits registers |
| Q8 | What exactly makes the reconciliation report "FTA-ready" (required fields/layout/sign-off)? | B1 | Spec the format instead of assuming |
| Q9 | AI provider, cost, and what bank/transaction text leaves the environment; accuracy bar for sign-off; bulk-confirm guardrails | B2, C1 | Data handling and auditability |
| Q10 | Petty cash: COA account per fund, VAT-on-voucher path into F, shortage/overage posting, approval rules. **Schema (§0.1):** `1000` Petty Cash exists as one account. Fund-per-account, VAT path, and variance posting are still open. | D | Avoids VAT-201 and ledger surprises later |
| Q11 | Currency: AED-only for all of 1.2? **Schema (§0.1):** base currency defaults to AED; `1040` USD is an active COA account with no FX subledger; `1050` EUR is inactive. Multi-currency matching is still open. | A1, B1 | Bank accounts and statements in foreign currency change matching and balances |
| Q12 | BullMQ (or equivalent) provisioned? **Code (§0.1):** a BullMQ queue exists for document OCR and does not start without `REDIS_URL`. Batch upload stays off unless `DOCUMENT_OCR_BATCH_ENABLED=true`. Redis is not confirmed in this environment. Daily pulls and 5-year imports still need that confirmation. | A2, C1 | New infrastructure, not application code |

---

## Summary — what to do right now

**Completed:** Nothing in Module 1.2 is built. §0.1 records what
`schema.sql` already has. Module 1.1's built set (A, C, D, E, F, G, H1,
H2, and 1.1.B B1) is the foundation.

**Next:**

1. **Resolve Q1** (feed-first vs ledger-first) — it shapes the staging table,
   the matching rules, and historical import. Do this before writing any
   1.2 spec.
2. **Write `feature-spec-1_2_A.md` Part I (A1)** — bank accounts, CSV/OFX
   import, staging + dedupe. Resolve Q2, Q11 first.
3. **Start Lean onboarding in parallel** (commercial, sandbox, coverage
   verification — Q3). Engineering lands at #3, but the lead time is external.
4. **Confirm queue infrastructure** (Q12) before scoping any timeline for
   A2, C1, or B2.
5. **Write `feature-spec-1_2_B.md` Part I (B1)** once A1 is specced — resolve
   Q4, Q5, Q7, Q8 first. Include the inherited `1070 → 1020` clearing entries
   (D-12).
6. **Petty cash (D)** can be specced and built on a parallel track any time —
   resolve Q10 first, especially the VAT path into F.
7. **Do not implement B2, C1, or C2 from this document** — each needs its own
   spec grounded against `schema.sql`, the same way H2 was.
8. Module 1.1.B B2 (`feature-spec-1_1_B.md` §0.4 / §6) may store a PDF
   and OCR text only. Structured bank lines land in the §1 staging table
   once that table is in `schema.sql`. B2 does not match or post. H-R
   items, C §9, D §7, and E §7 are unchanged.
