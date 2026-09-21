# Module 1.1.E — Accounts Payable Management
## Feature Specification (Source of Truth)

Part of Module 1.1 · AI-Based Accounting Foundation, inFINity Phase 1 (MVP).
This is the scope document for Module 1.1.E only — do not infer scope
from Module 1.1.A/C/D/H1 or other 1.1.B/F/G modules.

**Status: ✅ built (2026-09-13).** Schema (§3), posting RPCs (§4), Nest AP
surface (§5.5), and AP reports (§5) are live. §7 deferrals remain. §2 is
the ratified decision log (E-1…E-28); §9 is the chronological index.
Grounded against `schema.sql`, the finalized
`Chart of Accounts - inFINity.xlsx` (via
`seed_finalized_coa_demo_company_0002.sql`), and Accounting Rules
§1.5 / §4.2 / §1.24. Open flags from the first draft are closed in E-2
and E-14…E-22. Six policy calls on 2026-09-13 are E-23…E-28; append
E-29+. Full D-P13 Jest suite was **not** re-run on landing — see §8.

**Build Order context:** per `Module_1.1_Build_Order_Scope.md` §4, E is
sequenced fourth — after A (Module 0) and D (Module 3), not strictly
dependent on D, but sequenced to share D's established patterns
(subledger header/applications shape, aging buckets, advisory-lock
namespaces) rather than drifting into a divergent design. **E-1
resolves the Build Order's Bill-entity question as Option A** (`bills`
table, not a `journal_entries` row).

**Dependencies, verified directly against `schema.sql`:** Module 0 (A) —
`companies`, `accounts`, `journal_entries`, `journal_lines`,
`is_ledger_truth_status()`, `reverse_journal_entry`,
`journal_approval_threshold`, the `hashtext('<ns>:' || id)` advisory-lock
convention. Module 2 (C) — `customers`, `invoices` / `invoice_status`,
`payment_terms_type`, per-line `vat_rate`, Issue-time numbering + posting.
Module 3 (D) — `payments` / `payment_applications`, `payment_method_type`,
D-6 `company_settings.default_bank_account_id` (`1020`), D-12 routing
(`1010` / `1020` / `1070`), D-5 aging buckets.

*(Pre-build evidence, written before E landed — the status line above
is current. `suppliers` / `bills` / AP tables exist in `schema.sql`. Do
not re-litigate this paragraph as live schema.)* No `suppliers`,
`bills`, or AP tables exist yet — E is fully greenfield on schema.

**Confirmed directly against the finalized COA** (same file D-2 used):

| Purpose | Account | Basis |
|---|---|---|
| Accounts Payable (control) | `2000` Accounts Payable - Trade | `[Control]`; `INFINITY_ACCOUNTING_DOCUMENTATION.md` names it the unused AP control |
| Bank/Cash default | `1020` Bank Account - Current (AED) | D-6, already on `company_settings.default_bank_account_id` |
| Cash on Hand | `1010` | D-12 routing, reused (credit side) |
| Merchant / Payment Gateway Clearing | `1070` | D-12 routing, reused (credit side) |
| VAT Receivable (Input VAT) | `1400` | `[Control][Recoverable Input VAT]`; pair of C's `2200` |
| Supplier advances / trade prepayments | `1350` Supplier Advances | E-23 — dedicated asset, not `1320`; pair-symmetry with D keeping `2050` retainers off `2060` |
| Purchase discounts (contra-expense) | `5060` Purchase Discounts & Returns | `[Contra-Expense]`, credit normal balance — pair of C's `4060` |
| GRNI (goods received, not invoiced) | `2020` Accrued Purchases (Goods Received, Not Invoiced) | `[Detail]`; Accounting Rules §1.5 period-end accrual (E-21) |

**Accounting Rules sourced here** (PDF, Part 1.5 / 4.2 / 1.24 — source of
truth #1): three-way match before a bill is approved *for payment*;
duplicate detection (supplier + amount + date/reference) before posting;
AP aging mirrored from AR; period-end accrual of unbilled receipts;
bills carry a sequential internal reference; POs post nothing on create.

---

## 1. Scope boundary

Source deliverables for this pass, each mapped to a section:

| # | Deliverable | Section |
|---|---|---|
| 1 | Supplier ledger — full transaction history, running balance | §5.1 |
| 2 | Aged payables report — by supplier and by due date | §5.2 |
| 3 | Supplier statement reconciliation — match inFINity records against supplier statement | §5.3 |
| 4 | Batch payment — select multiple bills, generate one payment run | §4.3 |
| 5 | Payment scheduling — flag bills for payment on a future date | §4.4 |
| 6 | Supplier advance payment — prepayment before bill received | §4.5 |
| 7 | Duplicate bill detection — same amount + same supplier within 30 days | §4.6 |
| 8 | Three-way match — PO vs delivery note vs supplier invoice, flag discrepancies | §4.7 |

Plus two items required by Accounting Rules §1.5 that the eight
deliverables did not name, added the same way D added ECL (Rules §1.4)
rather than silently dropped:

| Extra | Section | Why in this pass |
|---|---|---|
| Period-end GRNI accrual (`2020`) | §4.8 / E-21 | Rules §1.5: "Accrued but unbilled liabilities … must be accrued at period-end" |
| Sequential internal bill number | §3.2 / E-16 | Rules §4.2: "Bills: mirror invoice rules — sequential internal reference" |

**Explicitly out of scope for this pass** (see §7 for detail): actual
bank-file generation or wire-transfer execution (E records that a
payment was made, it does not move money); VAT input-tax reclaim,
blocked-input reclass, reverse-charge (`1410`/`2210`) (Module F); OCR /
automated ingestion of supplier bills, POs, delivery notes, or
supplier statements (Module B — E defines the landing schema, B fills
it); PDF/XLSX/CSV export mechanics generally (Build Order §8,
H-remainder); automated payment-due reminders to internal staff beyond a
flag/report; multi-currency; company-settings admin API; vendor credits
/ supplier credit notes; recurring bills; inventory costing / landed
costs; perpetual GRNI on every goods receipt (period-end only, E-21);
`1070 → 1020` settlement (same deferral as D-12).

**Depends on:** Module 0 (A — ledger engine, accounts, journal posting)
only, per Build Order §4. Sequenced after D for pattern-consistency, not
because it consumes D's tables — E introduces its own `suppliers`
entity, the mirror of C's `customers`.

---

## 2. Decision log

Numbered. E-1…E-13 were in the first draft; E-2 / E-3 / E-9 / E-12 are
updated in place because this draft was never ratified and those four
were explicitly OPEN or `[NEEDS VERIFICATION]`. E-14…E-22 closed the
remaining first-pass flags. E-23…E-28 (2026-09-13) supersede specific
rows of E-2 / E-10 / E-12 / E-20 — those original entries stay as
written; standing rules in §3–§5 follow the later number. Further
changes append E-29+.

### E-1 — Bill entity: separate `bills` table (Build Order Option A)

**Decision:** a Bill is its own table, `bills`, with its own lifecycle
(`draft → matched → issued → partially_paid/paid`, plus
`disputed`/`void`) and its own journal linkage once posted — the same
shape D used for `payments` relative to `journal_entries`, and the same
shape C used for `invoices` relative to `journal_entries`. Not a
`journal_entries` row with an extended `entry_type` (Option B).

**Why:** per Build Order §4, three-way match and duplicate-detection
need a genuine pre-posting lifecycle — a bill can exist, be matched
against a PO/goods-receipt, be disputed, and sit unapproved for days,
all before it is ever a journal entry. Option B's draft→posted model
(inherited from A's simpler manual-entry assumption) has no room for
"matched but not yet approved," "disputed," or the AP-specific fields
(PO reference, delivery-note reference, supplier's own invoice number,
match status) a side table under Option B would need anyway — at which
point Option B is just Option A with extra steps. This is the one
decision the Build Order flagged as needing to be made *before* scoping
E; adopting its own recommendation rather than reopening the question.

### E-2 — GL accounts: resolved against the real COA, not invented

**Superseded for supplier advances by E-23:** post advances to `1350`,
not `1320`. The rest of this entry (control accounts, no default
expense account, leave `1330`/`1140`/`1410`/`2210` alone) still stands.

**Decision:** account numbers below are read directly from
`seed_finalized_coa_demo_company_0002.sql` / the finalized xlsx, the
same discipline D-2 used. No number is invented.

| Purpose | Account | Basis |
|---|---|---|
| Accounts Payable | `2000` | Control account; unused by any posting RPC today |
| Bank/Cash default | `1020` | D-6; `company_settings.default_bank_account_id` |
| Cash on Hand | `1010` | D-12 |
| Card/POS clearing | `1070` | D-12 |
| Input VAT | `1400` | Control; pair of C's `2200` output VAT |
| Supplier advances | `1320` Prepaid Expenses - Other | Residual Prepayments bucket (see below) |
| Purchase discounts | `5060` | Contra-expense; pair of C's `4060` |
| GRNI accrual | `2020` | Named for this exact use; E-21 |
| Default expense on bill lines | **none** | Bill lines require `account_id` at Issue, same as `invoice_lines.income_account_id` being required at Issue (`INVOICE_LINE_MISSING_INCOME_ACCOUNT`). No vat-rate → expense-account auto-suggest: C's 4000/4010/4020/4040 segmentation is a *revenue* COA fact that has no purchase-side equivalent. |

**Why `1320` for advances, not a new number and not `1330`:** there is
no account named "Supplier Advances" anywhere in the COA (the 1300–1340
band is Prepaid Rent / Insurance / Other / Deposits Paid / Staff Visa
deposits; 1140 is *employee* advances). D-7's rule was: do not repurpose
an account whose description is a different concept (`2050` retainers
were not used for customer deposits because `2060` already named that
job). Here the residual bucket *is* the matching concept: `1320 Prepaid
Expenses - Other` is the catch-all for trade prepayments that are not
rent, insurance, or refundable deposits. `1330 Deposits Paid (Refundable)`
is a deposit expected back in cash, not a prepayment applied to a later
bill — leaving it untouched, same as D-7 left `2050`/`1120` untouched.
A dedicated `1350 Supplier Advances` would be a COA extension, which
this spec does not make. If an accountant later wants a named 1350, that
is a new decision (E-25+) plus a COA change, not a silent renumber.

**Not used, on purpose:** `1410`/`2210` reverse-charge (Module F);
`5800` Non-Recoverable Input VAT Expense and `5580` blocked entertainment
(Module F — E posts recoverable input to `1400`; F reclasses blocked
input). `2010` Accrued Expenses is a generic period-end accrual, not
the GRNI account — `2020` is the one whose name is the Rules §1.5 fact.

### E-3 — `suppliers`: new table, greenfield, mirrors C's `customers`

**Decision:** `suppliers` (§3.1) is new — nothing in A or D provides a
supplier entity. Column names/types copy `customers` (schema.sql line
687–708) where the concepts overlap, and diverge only where AP needs
payout details that customers do not have.

Verified `customers` shape this table mirrors:

- `supplier_name` (not `name`) — `customers.customer_name`
- `trn` nullable, partial unique `(company_id, trn) where trn is not null`
  (C decision #1)
- `trn` immutable after create (C decision #17) — deactivate + new
  row to correct
- `email`, `phone`, `billing_address`, `is_active` (soft deactivate,
  `PATCH …/deactivate`, no hard delete)
- `default_payment_terms` + `custom_days` — see E-18
- AP-only: `bank_name`, `iban` (plain text; no structured payout
  sub-object — YAGNI until a payments-file module exists)
- No `credit_limit` / ECL columns — those are AR-only (D-4 / D-8)

**Why no shared "party" table:** E is scoped as C's mirror on the
purchase side (Build Order §4), and C had to build `customers` from
nothing for the same reason — there is no shared party table in A to
extend.

### E-4 — One `supplier_payments` table for both payments and advances

**Decision:** mirrors D-1 exactly, reversed direction. A single
`supplier_payments` header table; a row with zero
`supplier_payment_applications` children *is* an advance, and gains
applications later as it's matched to bills. No separate `advances`
table.

**Why:** same reasoning D-1 gave — structurally the same event (cash
paid to a supplier) at different points in its application lifecycle.
Reusing D-1's resolved shape rather than re-deriving it keeps AR and AP
consistent, which is the whole point of sequencing E after D (Build
Order §4).

### E-5 — Batch payment run: a wrapper layer above `supplier_payments`, not a replacement for it

**Decision:** add `supplier_payment_runs` (header: one batch, e.g. "this
week's payment run") and `supplier_payment_run_items` (one row per bill
selected into the run, possibly spanning several suppliers). On
execution, the run groups its items **by supplier** and generates one
`supplier_payments` row (+ `supplier_payment_applications`, + one
journal entry) per supplier in that run — not one giant multi-supplier
journal entry. The run header carries `payment_method` and optional
`bank_account_id` so every generated payment inherits the same routing
(D-12 inverted, E-6).

**Why:** D's `payments` row is scoped to one customer per row by
construction (§4.2: several invoices, same customer, one transaction).
A supplier batch run is explicitly the opposite case — many suppliers,
one administrative batch — so it needs a level D didn't: something that
groups bills *before* they're split back out per-supplier for posting.
Keeping the per-supplier `supplier_payments` row as the actual posting
unit means GL posting logic doesn't fork into a special multi-supplier
case; the run is purely an organizing/approval layer on top of the same
posting primitive E-4 already defines. The run's own
`draft → approved → executed` workflow is also the AP disbursement
approval Accounting Rules §1.24 asks for ("approval workflows for payments
above configurable thresholds") without a second, AP-specific JE
threshold — see E-12.

### E-6 — Payment bank account: reuse D-6's `default_bank_account_id`, no new column

**Decision:** `company_settings.default_bank_account_id` (added by D-6,
seeded to `1020`) is reused as-is for AP payments. `supplier_payments`
gets its own optional `bank_account_id` override, same pattern as D's
`payments.bank_account_id`. Credit-account routing by `payment_method`
reuses D-12's table inverted (money out):

| `payment_method` | Default **credit** account |
|---|---|
| `cash` | `1010` Cash on Hand |
| `bank_transfer`, `cheque`, `other` | `company_settings.default_bank_account_id` (D-6, `1020`) |
| `card`, `pos` | `1070` Merchant / Payment Gateway Clearing |

**Why:** it's the same real-world fact — which bank account this
company's cash actually sits in — not an AR-specific concept. Adding a
second, AP-specific default-bank-account setting would just create two
columns that need to be kept in sync for no reason. `1070 → 1020`
settlement stays out of scope, same as D-12 / D §7.

### E-7 — Payment scheduling: a flag, not a posting event

**Decision:** `bills.scheduled_payment_date` (nullable date). Setting it
marks a bill as queued for a future payment run; it does not create a
`supplier_payments` row, does not touch `journal_entries`, and does not
block the bill from being paid earlier or later by an ad hoc payment.
It is read by the batch-payment UI/report (§4.3) to suggest which bills
belong in the next run — advisory, not enforced.

**Why:** matches D-4's own reasoning for credit limits — the deliverable
says "flag," not "auto-pay" or "block." An actual scheduled/automatic
payment execution (a cron job that moves money on a date) is a
fundamentally different, higher-risk feature — moving money
automatically — than "surface this bill when it's due," and nothing in
the eight deliverables asks for unattended payment execution. If
auto-pay is wanted later, that's a new, explicit decision (E-25+), not a
retrofit onto this one.

### E-8 — Duplicate bill detection: alert-only, non-blocking, exact-match window

**Decision:** on bill create, on edit of `supplier_id` / `grand_total` /
`bill_date` / `supplier_invoice_number`, and again at Issue, check for
another **non-void** bill from the same `supplier_id` that matches
**either**:

1. **Deliverable rule:** same `grand_total` (exact, not a tolerance
   band) and `bill_date` within **30 calendar days** (inclusive, either
   direction); or
2. **Rules §1.5 reference rule:** same non-null `supplier_invoice_number`
   (the supplier's own reference), regardless of date window.

If found, the response includes `possible_duplicate_of` referencing the
closest match (nearest `bill_date`, then earliest `created_at`);
`bills.possible_duplicate_of` stores that id; the bill is still
created / still Issue-able. No unique constraint on
`supplier_invoice_number`.

**Why alert-only:** identical reasoning to D-4 — the deliverable's own
wording is "alert if," not "block." Accounting Rules §1.5 requires
*detection before posting*, which this satisfies (the check runs at
Issue); it does not require a hard stop. A hard stop needs an override
workflow that nothing in the deliverables asked for.

**Why exact amount, not a tolerance band:** "same amount" in the
deliverable reads as literal. A fuzzy-match version (e.g. ±2%) is a
plausible future refinement but is a materially different algorithm
that risks false positives on legitimately similar bills (e.g.
recurring services with the same round-number price).

### E-9 — Three-way match: needs `purchase_orders` and `goods_receipts`, both new

**Decision:** three-way match requires two entities that don't exist
anywhere yet — `purchase_orders`/`purchase_order_lines` and
`goods_receipts`/`goods_receipt_lines` (the "delivery note" /
goods-received note of Rules §1.5 and the deliverable). A `bills` row
can optionally reference a `purchase_order_id`; matching is evaluated
PO line ↔ goods-receipt line ↔ bill line by matching
`purchase_order_line_id` (bill lines carry an optional FK back to the PO
line they fulfill). POs themselves post **no journal entry** on create
(Rules §4.2).

**Match logic, per bill:**

- **Missing PO** — bill references no `purchase_order_id` → match
  skipped, `bills.match_status = 'no_po'` (not itself a discrepancy;
  many small / service bills legitimately have no PO).
- **Missing goods receipt** — PO exists, no `goods_receipts` row
  references it yet → `match_status = 'awaiting_receipt'`.
- **Quantity** — a bill line that references a PO line is OK when
  `bill_line.quantity` is within tolerance of **not exceeding** both
  (a) that PO line's ordered quantity and (b) the sum of
  `goods_receipt_lines.quantity_received` for that PO line.
  **Partial bills are not a mismatch** — billed 50 against ordered
  100 / received 100 matches. Billing *more* than ordered or received
  (outside E-10 tolerance) → `quantity_mismatch`.
- **Price mismatch** — bill line unit price vs PO line unit price,
  outside E-10 tolerance → `price_mismatch`. Both qty and price fail
  → `quantity_and_price_mismatch`.
- **Matched** — every bill line that references a PO line agrees on
  quantity (≤ ordered, ≤ received) and price, within tolerance →
  `match_status = 'matched'`.

Results persist to `three_way_match_results` (§3.8) rather than being
recomputed live on every read, since a match result should stay stable
once the PO/receipt/bill it was computed from is finalized (recomputed
only if any of the three is edited pre-Issue). `bills.match_status`
holds the current value; the results table is the audit trail (multiple
rows per bill allowed, latest `checked_at` wins).

**Why persisted, unlike D-10's aging snapshot decision:** D-10
explicitly avoided a snapshot table because a live aging query at the
right *time* is equivalent to a stored one. Three-way match doesn't have
that property — the discrepancy is a judgment about a specific
bill/PO/receipt combination at approval time, and the approver needs
to see *why* a bill was flagged after the fact.

**Flag vs block:** a quantity/price mismatch **does not block Issue**
(the deliverable's wording is "flags discrepancies"; recognizing the AP
liability is still correct). It **does block payment** (E-20), because
Rules §1.5 requires the three-way to reconcile "before an invoice is
approved for payment."

### E-10 — Match tolerance: company-configurable, defaults to zero

**Superseded by E-26:** do not use one blanket percentage. Quantity
tolerance defaults to **0%**; price tolerance defaults to **2%**. Two
`company_settings` columns replace `three_way_match_tolerance_pct`.

**Decision:** `company_settings.three_way_match_tolerance_pct
numeric(5,2)`, default `0` (exact match required). Applied to both
quantity and price comparisons in E-9. Quantity uses
`billed ≤ ordered × (1 + pct/100)` and
`billed ≤ received × (1 + pct/100)`. Price uses
`|bill_unit − po_unit| / po_unit ≤ pct/100` (if `po_unit = 0`, any
non-zero bill unit is a mismatch).

**Why a setting, not a hardcoded rule:** unlike D-13's weekend-days
decision (which had a real, confirmable default — the UAE federal
standard), there's no equivalent authoritative default for match
tolerance; it's a genuine business-policy choice that wasn't specified
in the deliverable. Defaulting to `0` (strict) is the safe interim
choice — it flags everything a looser tolerance would also flag, so no
discrepancy is silently hidden. **E ships no endpoint** to write this
setting in this pass; it is DB-level configuration until a
company-administration module exists (same boundary D-13).

### E-11 — Supplier statement reconciliation: E matches, B ingests

**Decision:** `supplier_statement_lines` (§3.13) is a structured staging
table — one row per line on a supplier's statement (date, reference,
amount, type). **This pass builds the matching logic and a manual entry
route to populate that table; it does not build PDF/CSV parsing of an
actual supplier statement document.** `reconcile_supplier_statement()`
(§5.3) matches statement lines against `bills` and
`supplier_payments` by supplier + amount + date/reference (E-22),
producing three buckets: matched, "in our books, not on their
statement," and "on their statement, not in our books."

**Why split here, not built one-off:** identical boundary to D's §5.4
statement-PDF split — document parsing/OCR is Module B's entire purpose
(Build Order §5). `supplier_statement_lines` *is* that structural target
for supplier statements. Building a one-off PDF/CSV parser inside E
would duplicate work B is explicitly scoped to do, and would need
reworking the moment B lands.

### E-12 — Document-engine posting posts the JE; no bespoke AP JE threshold

**Superseded in part by E-28:** bill Issue **does** apply the existing
`journal_approval_threshold` (AED 50,000 / TC9). Payment execution does
**not**. The "no new AP-only threshold column" part of this entry still
stands.

**Decision (revised against live C/D posting, 2026-09-10):** bill Issue
and supplier-payment posting **post the journal to `posted` in the same
RPC**, matching `create_invoice_journal_entry` (schema.sql ~1805–1808)
and `create_payment_journal_entry` (same pattern). A's
`journal_approval_threshold` is **not** applied to these
document-engine RPCs — confirmed: invoice Issue and D payments both skip
it (INFINITY_ACCOUNTING_DOCUMENTATION.md: "Approvals … Not applied to
invoice Issue"). Write-offs remain the exception (D-11) because they are
a different *risk category*.

A supplier bill or a supplier payment is the same category of
document-engine posting as a sales invoice / customer payment, not a
discretionary loss. Introducing a `bill_approval_threshold` or
`payment_run_approval_threshold` would be the overreach E-12 originally
declined.

**Where AP approval actually lives:**

1. **Bill Issue** is a human click (`POST /bills/:id/issue`) after
   match flags are visible — that click *is* the bill approval
   Accounting Rules §4.10 describes, enforced by the existing
   Owner/Accountant Nest guards, not a second number.
2. **Payment-run** `draft → approved → executed` (E-5) is the
   disbursement approval Accounting Rules §1.24 asks for.
3. **Cannot pay a mismatched / disputed / unissued bill** (E-20) —
   Rules §1.5's "before … approved for payment."

### E-13 — Undo path: reuse A's reversing-entry mechanism

**Decision:** a posted bill, payment, or advance application that needs
to be undone is reversed via A's standard `reverse_journal_entry`
mechanism (schema.sql §10, per D-8/D's own write-off undo path) — no
AP-specific undo/void logic beyond what status transitions require
(e.g. `bills.status = 'void'` alongside the reversal; `void_reason`
required, mirroring `invoices`).

**Why:** identical reasoning to D-8's write-off undo decision — the
project already has one correction mechanism; a second one is an
unjustified parallel path.

### E-14 — Bill live state is `issued`, not `approved`

**Decision:** `bill_status` is
`draft | matched | issued | partially_paid | paid | disputed | void`.
There is **no `approved` value and no `sent`/`viewed`/`overdue`**.

**Why:** C's `invoice_status` (schema.sql 1199–1209) uses `issued` as
the first live/posted state — numbering and journal posting both happen
on Draft → Issued (C decision #7). `journal_entry_status.approved` is a
*journal* workflow, not a document status; putting `approved` on bills
would collide with that word and invent a state invoices never had.
`sent`/`viewed` are CRM (C §9, out of scope for E — we are the
recipient, not the issuer). `overdue` is not needed: aged payables
already buckets off `due_date` (D-5 / Rules §1.5 "aging buckets
mirrored from AR"). No AP overdue cron.

`matched` is the AP-only holding state after three-way match has run
and before Issue. A no-PO bill still enters `matched` with
`match_status = 'no_po'` so Issue is a single transition from a known
match result, not a hidden match-inside-Issue.

### E-15 — `journal_entry_type` values (additive, confirmed enum name)

**Decision:** the enum is `journal_entry_type` (schema.sql 42–56),
additive-only per its own comment (C decision #13 / D §3.6). E adds:

| Value | When |
|---|---|
| `purchase_invoice` | Bill Issue (pairs with C's `sales_invoice`; Rules §1.3 name) |
| `supplier_payment` | Applied supplier payment (pairs with `customer_payment`) |
| `supplier_advance` | Unapplied supplier payment (pairs with `advance_receipt`) |
| `supplier_advance_application` | Cash-free reclass when an advance is applied (pairs with `advance_application`) |
| `grni_accrual` | Period-end unbilled-receipts accrual (E-21) |

Not `bill_posting` — that name would be the odd one out next to
`sales_invoice`.

### E-16 — Numbering: bills at Issue; POs and GRNs at create

**Decision:** follow C decision #8 / #16.

- **Bills:** `bill_number` allocated on Draft/Matched → Issued only,
  `allocate_next_bill_number`, lock `bil:`, format `BILL-YYYY-NNNN`.
  Unique `(company_id, bill_number) where bill_number is not null`.
  `supplier_invoice_number` remains the supplier's own tax-invoice
  number, distinct, not unique (E-8).
- **Purchase orders:** `po_number` allocated at row creation (BEFORE
  INSERT), like quotations — an internal document from first save.
  Lock `po:`, format `PO-YYYY-NNNN`. Unique `(company_id, po_number)`.
- **Goods receipts:** `receipt_number` allocated at create. Lock
  `grn:`, format `GRN-YYYY-NNNN`. Unique `(company_id, receipt_number)`.

**Why bills at Issue, not create:** Rules §4.2 "sequential internal
reference" + C's FTA-style "number locked when the document becomes
real." A draft bill is not yet a financial document. POs/GRNs are
operational documents from first save, so they number at create like
`QUO-YYYY-NNNN`.

### E-17 — Bill lines mirror `invoice_lines` (VAT, discounts, line_number)

**Decision:** `bill_lines` copies `invoice_lines` (schema.sql 1250–1267)
plus the AP-only `purchase_order_line_id`. Header totals
(`subtotal`, `vat_total`, `grand_total`) are DB-computed from lines while
`status = 'draft'` / `'matched'`, never client-set (C decision #3 / A
#10). `vat_total` not `vat_amount`. Each line has `vat_rate`
`numeric(5,2)` (same four-way 5 / 0 / exempt / out-of-scope Module F
will read — C §6.1). `discount_percent` XOR `discount_amount`. Unique
`(bill_id, line_number)`.

**GL at Issue (C decision #12 inverted):**

- **Debit** each line's `account_id` for that line's gross
  (qty × unit_price, VAT-exclusive).
- **Credit** `5060` for any line-level discount sum — never netted
  silently into the expense debit.
- **Debit** `1400` for `vat_total`.
- **Credit** `2000` for `grand_total`.

One journal entry per bill. `entry_type = 'purchase_invoice'`. Lines
without `account_id` at Issue raise `BILL_LINE_MISSING_ACCOUNT` (mirror
of `INVOICE_LINE_MISSING_INCOME_ACCOUNT`).

Blocked input VAT (entertainment, personal vehicles — Rules §2.2) is
**not** auto-flagged here; E always posts recoverable input to `1400`.
Module F owns the blocked-input reclass onto `5800`/`5580`.

### E-18 — Payment terms reuse C's enum; `due_date` is server-derived at Issue

**Decision:** `bills.payment_terms payment_terms_type not null default
'net_30'` + nullable `custom_days`, identical to `invoices` (schema.sql
1191–1193, 1219–1220). `due_date` is computed at Issue from
`bill_date + terms` (C decision #10), not client-set. Suppliers store
`default_payment_terms payment_terms_type` + `custom_days`; a new bill
copies those defaults at create, still overridable while draft.

**Why not `payment_terms_days integer`:** that was a first-draft guess.
The enum already exists and is what invoices use; inventing a parallel
days integer would drift AP due-date logic from AR.

### E-19 — Totals, locks, void: same C invoice guards

**Decision:** while `status = 'draft'` or `'matched'`, lines and
header dates/terms/PO are editable; `subtotal`/`vat_total`/`grand_total`
are recalc-trigger-only. Once `issued`, header fields that would change
the posted fact are blocked (`BILL_HEADER_MUTATION_BLOCKED` /
`BILL_LINE_MUTATION_BLOCKED`), matching
`prevent_nondraft_invoice_header_mutation`. `amount_paid` / `paid_at`
are never client-set (D §4.1). Void of an issued bill requires
`void_reason` and calls `reverse_journal_entry` in the same
transaction (C Batch 2). Applications against a void bill are
rejected.

### E-20 — Payment is blocked on a failed three-way match (Rules §1.5)

**Superseded in part by E-25:** the default is still a hard block;
an Owner may override with a mandatory reason logged distinctly from a
clean match. The "no silent force-pay / do not flip `match_status`"
discipline still stands.

**Decision:** `supplier_payment_applications` (ad hoc or via a
payment run) are rejected unless the bill is `issued` or
`partially_paid` **and** `match_status in ('matched', 'no_po')` **and**
`status <> 'disputed'`. Tokens: `BILL_NOT_OPEN_FOR_PAYMENT`,
`BILL_MATCH_BLOCKS_PAYMENT`, `BILL_DISPUTED`. No override/force-pay
workflow in this pass (same boundary D-4 / E-8 drew for blocking).

**Why block payment but not Issue:** Rules §1.5's own words are
"reconcile before an invoice is approved **for payment**." Recognizing
the liability (Issue) and disbursing cash are different gates. The
deliverable's "flag discrepancies" is the Issue-time alert; the Rules
are the payment-time stop. A no-PO bill is payable — many genuine
expenses never have a PO.

### E-21 — Period-end GRNI accrual to `2020` (Rules §1.5)

**Decision:** goods receipts **do not post a journal** when recorded
(they are matching documents). At period-end, an explicit RPC
`accrue_unbilled_receipts(company_id, period_end_date, created_by)`
posts one `grni_accrual` entry:

- For each PO line: `unmatched_qty = quantity_received − quantity_billed`
  (quantity billed = sum of `bill_lines.quantity` on non-void bills
  in `issued`/`partially_paid`/`paid` that reference that PO line, with
  `bill_date ≤ period_end`).
- If `unmatched_qty > 0`: **Debit** that PO line's `account_id` for
  `unmatched_qty × unit_price`, **Credit** `2020`, summed into one JE
  per company per period.
- Unique `(company_id, period_end_date)` on `grni_accrual_runs`.
- Guarded by `grni:` advisory lock; refuses if the target period is
  already `closed` (D-10's same defensive check).
- The JE is a **reversing accrual**: it is reversed in the next open
  period via A's `reverse_journal_entry` (standard reversing-accrual
  pattern) so that when the bill later Issues (`Dr` expense `Cr 2000`)
  the expense is not double-counted across periods.

**Why period-end, not perpetual on every GR:** Rules §1.5 says "must
be accrued **at period-end**," not on each receipt. Perpetual GRNI
would also collide with the not-yet-built inventory module (Rules §1.9
/ §4.2 landed costs). PO lines therefore carry `account_id` (the expense
or asset to accrue against) even though POs post nothing themselves.

**Not a silent cron in this pass.** D's ECL has a scheduled host
because D-10 specified T+5. Rules §1.5 does not specify a clock; E
exposes the RPC and a Nest `POST /reports/accrue-unbilled-receipts`
(or journal-entries-adjacent) call for month-end. Wiring it onto C's
01:00 UTC cron is a later decision (E-25+) if an accountant wants it
unattended — do not invent a T+N here the way D-10 had one.

**Opening `2020` balance:** AED 0. First run builds from unmatched
receipts present at that `period_end`.

### E-22 — Statement match: exact amount + reference, else amount + 7 calendar days

**Decision:** a suggested match of a `supplier_statement_lines` row to
a posted bill or `supplier_payments` row (same `supplier_id`) is, in
order:

1. Exact `amount` **and** `reference` = `bills.supplier_invoice_number`
   or `supplier_payments.reference_number` (Rules §1.5
   "date/reference"); else
2. Exact `amount` **and** statement `line_date` within **7 calendar
   days** (inclusive) of `bill_date` / `payment_date`.

Matching is suggestive, never auto-committed — a user confirms.
Confirmed matches set `matched_bill_id` or `matched_payment_id` and
`match_status = 'matched'`. The 7-day window is a fixed rule (the
deliverable did not specify a proximity); revisit as E-25+ if a
setting is requested. Not 30 days — that window is E-8's duplicate
detector, a different job, and would over-match recurring same-amount
bills on a statement.

### E-23 — Supplier advances post to `1350`, not `1320`

**Decision:** create dedicated COA account **`1350 — Supplier Advances`**
(asset, Prepayments, debit, `[Detail]`, default active). Supplier
advance payment is `Dr 1350` / `Cr` routed bank/cash; application to a
later bill is `Dr 2000` / `Cr 1350`. Do **not** post either leg to
`1320 Prepaid Expenses - Other`.

This is an explicit COA extension (180 Excel rows + 4 hierarchy demos
= **184** accounts). `1320` remains the catch-all for time-amortised
prepaid expenses that are not rent, insurance, or deposits. `1330`
Deposits Paid (Refundable) and `1140` employee advances stay unused
for this job.

**Why not `1320`:** general prepaid expenses amortize on a time
schedule; supplier advances are tracked per-vendor and applied against
a specific future bill (which three-way match / `supplier_payment_applications`
must reference directly). Dumping both into `1320` mixes two behaviors.
This is the same call D made on the AR side: `2050` Retainer Liability
was kept separate from generic liabilities, and customer deposits went
to named `2060` rather than a residual bucket.

**Why a new number is allowed here:** E-2 declined to invent `1350`
because the then-current COA had no such row. This entry *is* that
COA change, made on the owner's 2026-09-13 call, not a silent
renumber of E-2.

### E-24 — Period-end GRNI accrual is in this pass (confirms E-21)

**Decision:** build `accrue_unbilled_receipts` now, as the
manual-trigger RPC E-21 already designed. Not optional polish, not
deferred, not a silent cron.

**Why now:** Accounting Rules **§1.22** period-end close checklist
assumes accruals are posted before trial-balance review. Skipping GRNI
means every close where goods arrive before the supplier invoice —
which will happen regularly — produces an understated balance sheet.
Because the trigger is manual, this is a contained RPC, not a new
automation subsystem. E-21's posting ( `Dr` PO-line `account_id` /
`Cr 2020`, reversing in the next open period) is unchanged.

### E-25 — Three-way match failure: block with authorized override

**Decision:** payment is **blocked by default** exactly as E-20
(`match_status in ('matched', 'no_po')`, not disputed, bill
`issued`/`partially_paid`). An **Owner** may override that block with
a **mandatory non-blank reason**. The mismatch itself is **not**
rewritten to `matched` — `bills.match_status` and
`three_way_match_results` stay as the check computed them. The
override is a separate, auditable fact on the bill:

```
payment_match_override_reason  text
payment_match_overridden_by    uuid  -- company_members / users
payment_match_overridden_at    timestamptz
```

CHECK: all three override columns are null together, or the reason is
non-blank *and* `overridden_by` / `overridden_at` are set (same shape
as `ecl_override_reason` / period `reopen_reason`). Payable when
`match_status in ('matched', 'no_po')` **or** the override triple is
populated. Token remains `BILL_MATCH_BLOCKS_PAYMENT` when neither
holds.

**Who may override:** **Owner only** — the same authorized role as
Module 1.1 TC10 / soft-closed period posting
(`JournalEntriesService`: *"Only an Owner may post into a soft-closed
period with override"*; reason required, logged on the period's
`reopen_*` columns, distinct from a normal open-period post). Manager
may approve a pending journal (A's journal-approve path) but may
**not** override a failed three-way match. Accountant cannot.

**Why not a flat never-override:** a quantity/price hard-stop with no
recourse stalls legitimate payments (partial shipment, documented
price renegotiation outside the PO) and creates pressure to work
around the system. Block-by-default plus an explicit Owner reason
keeps the control real without backing the business into a corner.

**Audit:** the override is logged distinctly from a clean match — the
results table still shows the discrepancy; the bill columns (and the
existing journal/audit trail for the mutation) show who overrode and
why. Do not invent a second audit table.

### E-26 — Split three-way match tolerance: 0% quantity, 2% price

**Decision:** replace the single E-10 column
`three_way_match_tolerance_pct` with two `company_settings` columns,
still DB-level configuration, still **no settings write API** this
pass (D-13 boundary):

- `three_way_match_qty_tolerance_pct numeric(5,2) not null default 0`
- `three_way_match_price_tolerance_pct numeric(5,2) not null default 2`

Quantity (E-9 partial-bill rule unchanged): billed is OK when
`billed ≤ ordered × (1 + qty_pct/100)` **and**
`billed ≤ received × (1 + qty_pct/100)`. Default **0%** means any
billed quantity above ordered or received is always a
`quantity_mismatch`. Partial bills (billed 50 against ordered 100 /
received 100) still match.

Price: `|bill_unit − po_unit| / po_unit ≤ price_pct/100`. Default
**2%**. If `po_unit = 0`, any non-zero bill unit is a mismatch.

**Why split, not one blanket %:** a quantity mismatch is almost always
meaningful (partial delivery, short-shipment) and must always
surface. Exact price matches fail often in practice from rounding or
freight/duty allocation; 0% on price generates enough false-positive
flags that people start ignoring them, which defeats the check.

### E-27 — Statement matching window stays 7 calendar days

**Decision:** E-22 stands as written. Suggested match is exact amount
+ reference, else exact amount ± **7 calendar days** (inclusive) each
direction; user confirms; not a setting this pass.

**Why keep 7, not same-day and not wider:** same-day-only misses valid
matches (bank processing alone routinely lags 2–3 days). Widening
further increases false-positive matches when two different invoices
share a similar amount. 7 days each way is the starting default —
same "start here, refine against real data later" approach used for
ECL loss rates (D). Revisit as E-29+ only with evidence, not as a
pre-build guess.

### E-28 — AED 50,000 approval gate at bill Issue, not at payment

**Decision:** apply the existing `company_settings.journal_approval_threshold`
at **bill Issue only**. Do **not** invent a new number and do **not**
add `bill_approval_threshold` / `payment_run_approval_threshold`. The
product figure is **AED 50,000** (Module 1.1 TC9 / D-11). `null` on
that column still means "approval disabled" (A's existing rule) — Issue
posts immediately.

**Issue flow** (`POST /bills/:id/issue`):

- Allocate `bill_number` on this click (extends E-16: the number is
  consumed when Issue is requested, including when the bill then
  parks in `pending_approval`).
- Compute `due_date`, run E-8 duplicate check.
- If `grand_total <` threshold **or** the actor is Owner **or**
  threshold is null: post the `purchase_invoice` JE immediately,
  status `issued` (C's Issue equivalent).
- If `grand_total ≥` threshold and the actor is not Owner: create the
  JE in `pending_approval`, bill status **`pending_approval`**.
  Owner or Manager then approve via `POST /bills/:id/approve` (thin
  wrapper over A's journal-approve path: Owner bypasses; Owner or
  Manager approve others). On post, bill becomes `issued`.

`bill_status` therefore gains `pending_approval` (extends E-14). It is
not named `approved` — that word stays a journal-entry status. A
pending bill is mutation-blocked like `issued` (extends E-19). Payment
applications still require `issued` / `partially_paid`, so a pending
bill cannot be paid (`BILL_NOT_OPEN_FOR_PAYMENT`).

For E-21 GRNI, a `pending_approval` bill does **not** count as billed
(its JE is not ledger-truth). Unmatched receipts remain accruable.

**Payment is not a second 50k gate.** Once the bill is `issued`,
payment execution for that amount does not re-test
`journal_approval_threshold`. Supplier-payment JEs still post
immediately, like D's customer payments. Payment-run
`draft → approved → executed` (E-5) stays an operational batch
workflow (this set of bills is ready to disburse); it is **not** a
second money-threshold approval.

**Partial payments:** inherit the original bill Issue approval. Each
partial application does **not** re-check `grand_total` (or the
partial amount) against the threshold. An explicit re-check rule can
be E-29+ if evidence warrants it; not a blocker now, but the inherit
rule is locked so E's existing `partially_paid` state has one answer.

---

## 3. Schema additions

Building on A's `companies`, `accounts`, `journal_entries`,
`journal_lines`, and following the same conventions C and D used (uuid
PKs via `gen_random_uuid()`, `company_id` FK on every tenant-scoped
table, `created_at`/`updated_at timestamptz not null default now()`).
**All tables below are new — E is greenfield on schema, same as D was.**
`suppliers` follows `customers` (`on delete cascade` on `company_id`);
`bills` follows `invoices` (no cascade on `company_id`).

### 3.1 `suppliers` (new) — per E-3, E-19

```
id                      uuid primary key default gen_random_uuid()
company_id              uuid not null references companies(id) on delete cascade
supplier_name           text not null
trn                     text                          -- nullable; FTA TRN
email                   text
phone                   text
billing_address         text
default_payment_terms   payment_terms_type not null default 'net_30'
custom_days             int                           -- required when terms = custom
bank_name               text
iban                    text
is_active               boolean not null default true
created_at              timestamptz not null default now()
updated_at              timestamptz not null default now()

constraint suppliers_custom_days_required check (
  default_payment_terms <> 'custom'
  or (custom_days is not null and custom_days > 0)
)
```

```
create unique index suppliers_company_trn_unique
  on suppliers(company_id, trn) where trn is not null;
create index idx_suppliers_company on suppliers(company_id);
```

`trn` is set at creation only — not patchable (C #17).
`is_active = false` via `PATCH …/deactivate`; new bills/POs against an
inactive supplier are rejected; existing documents are never
retroactively altered.

### 3.2 `bills` (new) — per E-1, E-14, E-16, E-18, E-25, E-28

```
id                      uuid primary key default gen_random_uuid()
company_id              uuid not null references companies(id)
supplier_id             uuid not null references suppliers(id)
bill_number             text                          -- BILL-YYYY-NNNN; set at Issue
supplier_invoice_number text                          -- supplier's own reference
purchase_order_id       uuid references purchase_orders(id)
bill_date               date not null
due_date                date                         -- set at Issue (E-18)
payment_terms           payment_terms_type not null default 'net_30'
custom_days             int
subtotal                numeric(18,2) not null default 0
vat_total               numeric(18,2) not null default 0
grand_total             numeric(18,2) not null default 0
amount_paid             numeric(18,2) not null default 0
paid_at                 timestamptz                  -- set once, mirrors D-3
status                  bill_status not null default 'draft'
match_status            bill_match_status
possible_duplicate_of  uuid references bills(id)     -- E-8
scheduled_payment_date  date                          -- E-7
journal_entry_id        uuid references journal_entries(id)
payment_match_override_reason  text                   -- E-25; null unless Owner override
payment_match_overridden_by    uuid
payment_match_overridden_at    timestamptz
void_reason             text
created_by              uuid not null
created_at              timestamptz not null default now()
updated_at              timestamptz not null default now()

check (amount_paid >= 0 and amount_paid <= grand_total)
check (payment_terms <> 'custom' or (custom_days is not null and custom_days > 0))
check (status <> 'void' or (void_reason is not null and btrim(void_reason) <> ''))
check (
  (payment_match_override_reason is null
   and payment_match_overridden_by is null
   and payment_match_overridden_at is null)
  or (
    payment_match_override_reason is not null
    and btrim(payment_match_override_reason) <> ''
    and payment_match_overridden_by is not null
    and payment_match_overridden_at is not null
  )
)
```

```
create type bill_status as enum (
  'draft', 'matched', 'pending_approval', 'issued',
  'partially_paid', 'paid', 'disputed', 'void'
);
create type bill_match_status as enum (
  'no_po', 'awaiting_receipt', 'quantity_mismatch', 'price_mismatch',
  'quantity_and_price_mismatch', 'matched'
);
create unique index bills_company_number_unique
  on bills(company_id, bill_number) where bill_number is not null;
create index idx_bills_company on bills(company_id);
create index idx_bills_supplier on bills(supplier_id);
create index idx_bills_status on bills(company_id, status);
```

### 3.3 `bill_lines` (new) — per E-17

```
id                      uuid primary key default gen_random_uuid()
bill_id                 uuid not null references bills(id) on delete cascade
line_number             smallint not null
purchase_order_line_id  uuid references purchase_order_lines(id)
description             text not null
quantity                numeric(18,4) not null check (quantity > 0)
unit_price              numeric(18,2) not null check (unit_price >= 0)
discount_percent        numeric(5,2)
discount_amount          numeric(18,2)
vat_rate                numeric(5,2) not null check (vat_rate >= 0 and vat_rate <= 100)
account_id              uuid references accounts(id)   -- required at Issue
line_total              numeric(18,2) not null default 0
unique (bill_id, line_number)
constraint bill_lines_discount_xor check (
  not (discount_percent is not null and discount_amount is not null)
)
```

### 3.4 `purchase_orders` (new) — per E-9, E-16

```
id            uuid primary key default gen_random_uuid()
company_id    uuid not null references companies(id)
supplier_id   uuid not null references suppliers(id)
po_number     text not null
po_date       date not null
status        po_status not null default 'open'
created_by    uuid not null
created_at    timestamptz not null default now()
updated_at    timestamptz not null default now()
unique (company_id, po_number)
```

```
create type po_status as enum (
  'open', 'partially_received', 'received', 'closed', 'cancelled'
);
```

No journal entry on create (Rules §4.2). Status `partially_received` /
`received` is derived from goods-receipt quantities vs ordered, not
manually set except `cancelled` / `closed`.

### 3.5 `purchase_order_lines` (new)

```
id            uuid primary key default gen_random_uuid()
po_id         uuid not null references purchase_orders(id) on delete cascade
line_number   smallint not null
description   text not null
quantity      numeric(18,4) not null check (quantity > 0)
unit_price    numeric(18,2) not null check (unit_price >= 0)
account_id    uuid not null references accounts(id)   -- E-21 GRNI debit
line_total    numeric(18,2) not null
unique (po_id, line_number)
```

### 3.6 `goods_receipts` (new) — delivery note / GRN

```
id                  uuid primary key default gen_random_uuid()
company_id          uuid not null references companies(id)
supplier_id         uuid not null references suppliers(id)
purchase_order_id   uuid not null references purchase_orders(id)
receipt_number      text not null
receipt_date        date not null
created_by          uuid not null
created_at          timestamptz not null default now()
unique (company_id, receipt_number)
```

No `journal_entry_id` — receipts do not post (E-21).

### 3.7 `goods_receipt_lines` (new)

```
id                      uuid primary key default gen_random_uuid()
goods_receipt_id        uuid not null references goods_receipts(id) on delete cascade
purchase_order_line_id  uuid not null references purchase_order_lines(id)
quantity_received       numeric(18,4) not null check (quantity_received > 0)
```

### 3.8 `three_way_match_results` (new) — per E-9

```
id                  uuid primary key default gen_random_uuid()
bill_id             uuid not null references bills(id)
purchase_order_id   uuid references purchase_orders(id)
goods_receipt_id    uuid references goods_receipts(id)
match_status        bill_match_status not null
details             jsonb           -- per-line expected vs actual qty/price
checked_at          timestamptz not null default now()
```

### 3.9 `supplier_payments` (new) — per E-4, E-6

```
id                uuid primary key default gen_random_uuid()
company_id        uuid not null references companies(id)
supplier_id       uuid not null references suppliers(id)
payment_date      date not null
amount            numeric(18,2) not null check (amount > 0)
payment_method    payment_method_type            -- D-12 enum, reused
reference_number  text
bank_account_id   uuid references accounts(id)   -- nullable; E-6 fallback
unapplied_amount  numeric(18,2) not null
journal_entry_id  uuid references journal_entries(id)
payment_run_id    uuid references supplier_payment_runs(id)
created_by        uuid not null
created_at        timestamptz not null default now()
updated_at        timestamptz not null default now()

check (unapplied_amount >= 0 and unapplied_amount <= amount)
```

Insert trigger sets `unapplied_amount = amount` (D `set_payment_unapplied_on_insert`).

### 3.10 `supplier_payment_applications` (new)

```
id                   uuid primary key default gen_random_uuid()
supplier_payment_id  uuid not null references supplier_payments(id) on delete cascade
bill_id              uuid not null references bills(id)
applied_amount       numeric(18,2) not null check (applied_amount > 0)
applied_at           timestamptz not null default now()
applied_by           uuid not null
```

Same trigger-recomputed `unapplied_amount` as D §3.3, lock `spay:` on
the payment id (mirror of `pay:`). Bill `amount_paid` / `paid_at` /
`partially_paid`/`paid` refreshed by a second trigger, lock `bilpay:`
per bill (mirror of `invpay:`). Over-application past `grand_total`
rejected (`BILL_APPLICATION_EXCEEDS_BALANCE`); excess stays on the
payment as `unapplied_amount`.

### 3.11 `supplier_payment_runs` (new) — per E-5

```
id                uuid primary key default gen_random_uuid()
company_id        uuid not null references companies(id)
run_date          date not null
payment_method    payment_method_type not null
bank_account_id   uuid references accounts(id)
status            payment_run_status not null default 'draft'
created_by        uuid not null
approved_by       uuid
executed_at       timestamptz
created_at        timestamptz not null default now()
updated_at        timestamptz not null default now()
```

```
create type payment_run_status as enum (
  'draft', 'approved', 'executed', 'cancelled'
);
```

Execute is guarded by `payrun:` on the run id so two concurrent execute
calls cannot double-post.

### 3.12 `supplier_payment_run_items` (new)

```
id            uuid primary key default gen_random_uuid()
run_id        uuid not null references supplier_payment_runs(id) on delete cascade
bill_id       uuid not null references bills(id)
supplier_id   uuid not null references suppliers(id)   -- denormalized for group-by
amount_to_pay numeric(18,2) not null check (amount_to_pay > 0)
included      boolean not null default true
unique (run_id, bill_id)
```

### 3.13 `supplier_statement_lines` (new) — per E-11, E-22

```
id                    uuid primary key default gen_random_uuid()
company_id            uuid not null references companies(id)
supplier_id           uuid not null references suppliers(id)
statement_date        date not null          -- statement as-of / header date
line_date             date not null
line_type             text not null        -- 'invoice' | 'payment' | 'credit' | 'other'
reference             text
amount                numeric(18,2) not null
source                text not null default 'manual'   -- 'manual' today; 'ocr' once B lands
matched_bill_id       uuid references bills(id)
matched_payment_id    uuid references supplier_payments(id)
match_status          text not null default 'unmatched'
                      -- 'matched' | 'unmatched_ours' | 'unmatched_theirs'
created_at            timestamptz not null default now()
check (
  match_status <> 'matched'
  or matched_bill_id is not null
  or matched_payment_id is not null
)
```

### 3.14 `grni_accrual_runs` (new) — per E-21

```
id                 uuid primary key default gen_random_uuid()
company_id         uuid not null references companies(id)
period_end_date    date not null
accrual_amount     numeric(18,2) not null
journal_entry_id   uuid references journal_entries(id)
reversal_entry_id  uuid references journal_entries(id)
created_by         uuid not null
created_at         timestamptz not null default now()
unique (company_id, period_end_date)
```

### 3.15 `company_settings` (extend) — per E-6, E-26

- No new bank-account column — reuses D-6's `default_bank_account_id`.
- `three_way_match_qty_tolerance_pct numeric(5,2) not null default 0` — E-26.
- `three_way_match_price_tolerance_pct numeric(5,2) not null default 2` — E-26.
- Do **not** add `three_way_match_tolerance_pct` (that was E-10's single
  column; E-26 replaced it before build).
- Duplicate-detection window (30 days) and statement-match window
  (7 days) are **not** settings (E-8, E-22 / E-27).
- Bill Issue reuses existing `journal_approval_threshold` (E-28); no
  new AP threshold column.

### 3.16 `journal_entry_type` enum (extend) — per E-15

Additive values: `purchase_invoice`, `supplier_payment`,
`supplier_advance`, `supplier_advance_application`, `grni_accrual`.

### 3.17 Advisory-lock namespaces

Existing (do not reuse for a different job): `quo:`, `qxp:`, `inv:`,
`ovd:`, `crn:`, `cnl:`, `rjt:`, `pay:`, `invpay:`, `wof:`, `ecl:`,
`vrl:`, `ob:`, `ye:`.

E adds:

| ns | Guards |
|---|---|
| `bil:` | `allocate_next_bill_number` per company |
| `po:` | `allocate_next_po_number` per company |
| `grn:` | `allocate_next_grn_number` per company |
| `spay:` | applications against one `supplier_payments` row |
| `bilpay:` | `amount_paid` refresh on one bill |
| `payrun:` | execute of one payment run |
| `grni:` | period-end GRNI RPC per company |
| `dup:` | optional; only if Issue-time duplicate scan needs serialising against concurrent creates — otherwise the E-8 select is a read |

Reuse the `hashtext('<ns>:' || id)` pattern; don't invent a new locking
approach.

---

## 4. Transactional rules

### 4.1 Bill lifecycle and status transitions

- `draft` — created, editable, no `bill_number`, no JE.
- `matched` — three-way match (§4.7) has run; `match_status` populated.
  A bill with no PO goes `draft → matched` with `match_status = 'no_po'`.
- `pending_approval` — Issue was requested at/above
  `journal_approval_threshold` by a non-Owner (E-28). `bill_number`
  allocated; JE exists in `pending_approval`; header/lines locked.
  Not payable.
- `issued` — JE posted: either immediately on Issue (under threshold,
  Owner, or threshold null) or after Owner/Manager `POST /bills/:id/approve`.
  This is the live-in-the-ledger state, C's Issue equivalent.
- `amount_paid` increments only via a `supplier_payment_applications`
  insert — never client-set (D §4.1).
- `amount_paid < grand_total` → `partially_paid`.
- `amount_paid = grand_total` → `paid`, `paid_at` stamped (D-3 mirror).
- `disputed` — manual status when the bill is queried with the supplier;
  blocks payment (E-20 / E-25); does not reverse an already-posted JE. Clearing
  dispute returns the bill to `issued` / `partially_paid` as implied by
  `amount_paid`.
- `void` — requires `void_reason`; reverses the JE if posted (E-13).
- Overpayment is rejected at the application layer — excess stays in
  `unapplied_amount` as advance credit against a different bill.

Issue is allowed from `draft` (match runs first) or `matched`. Issue
from `disputed`/`void`/`paid`/`pending_approval` is rejected.
`POST /bills/:id/approve` is allowed only from `pending_approval`.

### 4.2 Bill posting (GL)

On Issue, atomic RPC `create_bill_journal_entry` + `issue_bill`
(mirrors `create_invoice_journal_entry` / `issue_invoice`):

- `Dr` each bill line `account_id` for qty × unit_price
- `Cr 5060` for discount sum (if any)
- `Dr 1400` for `vat_total` (omit the line when `vat_total = 0`, same
  as C omits `2200` when `vat_total = 0`)
- `Cr 2000` for `grand_total`
- `entry_type = 'purchase_invoice'`; `status = 'posted'` in the same
  RPC when under threshold / Owner / threshold null (E-28); otherwise
  the JE is created `pending_approval` and posts on approve
- Requires an open accounting period covering `bill_date`
- Unbalanced → `BILL_POSTING_UNBALANCED`; missing `2000`/`1400`/`5060`
  → `BILL_POSTING_ACCOUNT_NOT_FOUND`

### 4.3 Batch payment (select multiple bills, one payment run)

- User selects open (`issued`/`partially_paid`) bills that pass E-20 /
  E-25 (matched, no_po, or Owner match-override present), possibly across
  suppliers, into a `supplier_payment_runs` row.
- Run moves `draft → approved` (human; `approved_by` stamped) before
  it can execute. This is operational batch-ready, **not** a second
  AED 50,000 money gate (E-28).
- On **execute** (`payrun:` lock): group included items by `supplier_id`.
  For each supplier group, create one `supplier_payments` row funding
  `supplier_payment_applications` against that supplier's selected
  bills, then post one JE per payment: `Dr 2000`, `Cr` routed account
  (E-6). `entry_type = 'supplier_payment'`. Execute does not re-test
  `journal_approval_threshold`.
- A bill that fails E-20 / E-25 at execute time is skipped and the run item
  flagged, not a silent pay.

### 4.4 Payment scheduling

- `bills.scheduled_payment_date` (E-7) is set directly on the bill —
  no separate table, no GL event.
- Aged payables / bill-listing views (§5.2 / §5.4) surface it
  alongside `due_date`. Nothing forces a bill into a run automatically.

### 4.5 Supplier advance payment

- Recorded as a `supplier_payments` row with `unapplied_amount = amount`,
  no applications yet (D §4.3 reversed).
- GL at payment: `Dr 1350`, `Cr` routed bank/cash (E-6 / E-23).
  `entry_type = 'supplier_advance'`.
- Application to a later bill: insert `supplier_payment_applications`,
  `unapplied_amount` decrements, cash-free reclass: `Dr 2000`, `Cr 1350`,
  `entry_type = 'supplier_advance_application'`. That reclass — not the
  original advance — is what moves `amount_paid` (D §4.3 mirror).
- Applying an advance still needs E-20 / E-25 (the *bill* must be payable);
  the advance itself can be recorded before any bill exists.

### 4.6 Duplicate bill detection

- Evaluated per E-8 on create / relevant edit / Issue.
- Alert-only: response includes the flag; `possible_duplicate_of`
  stores the match; Issue proceeds.

### 4.7 Three-way match

- Runs on `POST /bills/:id/match`, on linking/unlinking a PO, on
  relevant line edits while pre-Issue, and again inside Issue.
- Per E-9 / E-26: billed qty ≤ ordered and ≤ received (qty tolerance
  default 0%); billed unit price vs PO unit price (price tolerance
  default 2%).
- Persists to `three_way_match_results`; sets `bills.match_status`.
- Mismatch does not block Issue; it blocks payment unless an Owner
  override is recorded (E-20 / E-25). Do not flip `match_status` to
  `matched` on override.

### 4.8 Period-end GRNI accrual

- RPC `accrue_unbilled_receipts` per E-21 / E-24. One run per company per
  `period_end`. Posts `Dr` PO-line `account_id` / `Cr 2020`,
  `entry_type = 'grni_accrual'`. Next-period reversal via
  `reverse_journal_entry`. Not a silent cron in this pass.
  `pending_approval` bills do not count as billed (E-28).

---

## 5. Reporting

New reports follow D §5: a Postgres function filtered through
`is_ledger_truth_status()` wherever it aggregates from `journal_lines`,
exposed via a thin read route. Where a report reads subledger data
(`bills`, `supplier_payments`) rather than `journal_lines` directly,
only rows with a non-null `journal_entry_id` (actually posted) count.

### 5.1 Supplier ledger

`get_supplier_ledger(company_id, supplier_id, date_from?, date_to?)`
— same signature shape as `get_customer_ledger` (schema.sql 5255–5272).
Unions posted bills (credit `2000`), supplier payments (debit `2000`),
advance payments (debit `1350` — shown separately, `affects_ap = false`,
not netted into the AP running balance, mirroring D §5.1's treatment
of customer advances), advance applications (debit `2000`), ordered by
date, running balance in SQL.

### 5.2 Aged payables report

`get_aged_payables(company_id, as_of_date)` — D-5 buckets reused as-is
(`current` / `0-30` / `31-60` / `61-90` / `90+`, keyed off
`as_of_date − due_date`): per-supplier rows plus a totals row, over
bills with `amount_paid < grand_total` and status in
(`issued`, `partially_paid`).

**By due date** (the deliverable's second view): the same outstanding
set returned as a flat bill listing sorted by `due_date` via
`get_bills_due(company_id, as_of_date)` — not a second persisted table.

### 5.3 Supplier statement reconciliation

`reconcile_supplier_statement(company_id, supplier_id, statement_date)`
— per E-11 / E-22: reads already-entered `supplier_statement_lines` for
that supplier + statement date, suggests matches, returns the three
buckets. Confirm via `PATCH /supplier-statement-lines/:id/confirm-match`.

### 5.4 Batch payment / scheduled payments view

A read surface over `bills` filtered to `issued`/`partially_paid`,
showing `due_date`, `scheduled_payment_date`, `match_status`, and
outstanding balance — feeds §4.3 selection. Not a persisted report
function; a straightforward filtered listing (`GET /bills?status=`).

### 5.5 Nest surface (this pass)

Same guard stack as C/D: `SupabaseAuthGuard` + `CompanyMembershipGuard`
+ `@RequireCompanyMembership`.

| Method | Route | Notes |
|---|---|---|
| CRUD + deactivate | `/suppliers` | Mirror `/customers`; `trn` omitted from PATCH |
| CRUD + lines | `/purchase-orders`, `/purchase-orders/:id/lines` | Number at create |
| CRUD + lines | `/goods-receipts`, `/goods-receipts/:id/lines` | Number at create |
| CRUD + lines | `/bills`, `/bills/:id/lines` | Totals recalc while draft/matched |
| POST | `/bills/:id/match` | E-9 |
| POST | `/bills/:id/issue` | E-14 / E-28 / §4.2 |
| POST | `/bills/:id/approve` | E-28 — Owner/Manager; pending_approval → issued |
| POST | `/bills/:id/override-match-block` | E-25 — Owner; body `{ reason }` |
| POST | `/bills/:id/void` | E-13; body `void_reason` |
| PATCH | `/bills/:id/schedule` | `{ scheduled_payment_date }` E-7 |
| PATCH | `/bills/:id/dispute` | `{ disputed: boolean }` |
| CRUD + post | `/supplier-payments` | Mirror `/payments` + `POST :id/post` |
| POST / DELETE | `/supplier-payments/:id/applications` | E-20 / E-25 |
| CRUD + approve + execute | `/supplier-payment-runs` | E-5 / E-28 — execute is not a 50k gate |
| CRUD + confirm-match | `/supplier-statement-lines` | E-11 / E-22 |
| GET | `/reports/supplier-ledger` | §5.1 |
| GET | `/reports/aged-payables` | §5.2 |
| GET | `/reports/bills-due` | §5.2 flat view |
| POST | `/reports/reconcile-supplier-statement` | §5.3 |
| POST | `/journal-entries/accrue-unbilled-receipts` | E-21 — next to other period RPCs, not a "report" |

No company-settings write API (E-26 / D-13).

---

## 6. Relationship to existing schema

`suppliers`, `bills`, `bill_lines`, `purchase_orders`,
`purchase_order_lines`, `goods_receipts`, `goods_receipt_lines`,
`three_way_match_results`, `supplier_payments`,
`supplier_payment_applications`, `supplier_payment_runs`,
`supplier_payment_run_items`, `supplier_statement_lines`, and
`grni_accrual_runs` are all new. E adds no columns to any table A, C, or
D already owns, beyond:

- reusing (not altering) D-6's `company_settings.default_bank_account_id`
- adding `company_settings.three_way_match_qty_tolerance_pct` and
  `three_way_match_price_tolerance_pct` (E-26)
- additive `journal_entry_type` values (E-15)
- additive COA row `1350` (E-23); seed + Excel, not a `schema.sql`
  table change

No changes to `customers`, `invoices`, `credit_notes`, `payments`, or
any D/C table. E is a fully separate subledger, structurally parallel to
D, not layered on top of it.

---

## 7. Out of scope for this pass

- **Bank-file generation / wire-transfer execution** — E records that a
  payment happened (§4.3/§4.5); it does not initiate one.
- **VAT input-tax reclaim, blocked-input reclass, reverse charge** —
  Module F. E posts recoverable input to `1400` and leaves `1410` /
  `2210` / `5800` / `5580` untouched.
- **OCR / automated ingestion** of bills, POs, GRNs, or supplier
  statements — Module B (Build Order §5).
- **PDF/XLSX/CSV export** — Build Order §8 (H-remainder). Standing
  2026-09-20: H2-7 closed CSV for H1 four + H2 report routes only; E
  report CSV and PDF/XLSX remain deferred.
- **Duplicate-bill hard-block** — E-8 stays alert-only. Match-payment
  override is in scope (E-25); do not extend that override to
  duplicates unless E-29+ says so.
- **Automatic/unattended scheduled payment execution** — §4.4 is a
  flag; auto-pay is a new decision (E-7).
- **Unattended GRNI cron** — E-21 / E-24 is an explicit RPC; a 01:00 UTC host
  is E-29+ if an accountant wants D-16-style scheduling.
- **Vendor credits / supplier credit notes** — Rules §4.2 names
  them; they are not one of the eight deliverables. Out of scope until
  raised, same as C deferred presentation.
- **Recurring bills** — Rules §4.2; C also deferred recurring invoices.
- **Inventory costing / landed costs / perpetual GRNI** — Rules §1.9 /
  §4.2; no inventory module. Period-end GRNI (E-21) is the only
  unbilled-receipts path.
- **`1070 → 1020` settlement** — D-12 / D §7.
- **Multi-currency** bills, payments, or advances.
- **Company-settings admin API/UI** — D-13 boundary.
- **Configurable duplicate / statement windows** — E-8 / E-22 / E-27.
- **Supplier onboarding / bank-detail-change fraud controls** — Rules
  §1.24 "segregation of create-vendor from approve-payment" is a
  role-design concern for a later admin module; E uses the existing
  Owner/Accountant guards, it does not invent a second maker-checker
  matrix.
- **Bill overdue cron** — aging report covers it (E-14).

---

## 8. Build status / sign-off

**Module 1.1.E is built** (schema + RPCs + Nest §5.5 + reports). Pre-build
verification items from the first draft's §8 remain closed:

| # | Item | Resolution |
|---|---|---|
| 1 | OPEN GL accounts vs COA | E-2 / E-23 — `2000` / `1400` / `1350` / `5060` / `2020` / D-12 cash accounts |
| 2 | `customers` field shapes | E-3 — `supplier_name`, `trn`, `billing_address`, C #1/#17 |
| 3 | `issued` vs `approved` | E-14 / E-28 — live state `issued`; `pending_approval` only for the 50k Issue gate |
| 4 | `journal_entry_type` name | E-15 — confirmed `journal_entry_type`; values listed |

Remaining for D-style signed-off status:

1. ~~Build schema, RPCs, Nest AP routes, and reports per §3–§5.~~ Done 2026-09-13.
2. D-P13 discipline: a **full** fresh-DB `schema.sql` + COA seed + entire Jest
   suite was **not** re-run in the E landing pass (incremental apply to the
   Testing 1.1.A project). Unit 544 + E AP 8 + membership 3 + D invoices/payments
   24 were run. Fold all DDL into `schema.sql` — do not add separate
   `apply_*.sql` patches (per `schema.sql` header).
3. After E-23…E-28, never silently edit; append E-29+.

---

## 9. Decision Log Index

Chronological index — full text of each entry is in §2. Same
discipline as `feature-spec-1_1_D.md` §9: never silently edit an
existing row once written; append E-29+ if a decision must change.

| # | Date | Summary | Detail in |
|---|------|---------|-----------|
| E-1 | 2026-09-10 | Bill entity is its own `bills` table (Build Order Option A) | §2 E-1 |
| E-2 | 2026-09-10 | GL accounts resolved: `2000`/`1400`/`1320`/`5060`/`2020`; no default expense account. **Advances superseded by E-23.** | §2 E-2, §4.2–§4.5, §4.8 |
| E-3 | 2026-09-10 | `suppliers` mirrors `customers` (`supplier_name`, TRN unique+immutable, `iban`) | §2 E-3, §3.1 |
| E-4 | 2026-09-10 | One `supplier_payments` table for payments and advances | §2 E-4, §3.9, §4.5 |
| E-5 | 2026-09-10 | Payment run is a wrapper above per-supplier `supplier_payments` | §2 E-5, §3.11–§3.12, §4.3 |
| E-6 | 2026-09-10 | Reuse D-6 `default_bank_account_id`; invert D-12 routing on the credit side | §2 E-6, §4.3, §4.5 |
| E-7 | 2026-09-10 | Payment scheduling is a flag on the bill, not auto-pay | §2 E-7, §3.2, §4.4 |
| E-8 | 2026-09-10 | Duplicate detection: alert-only; 30-day amount **or** same supplier invoice number | §2 E-8, §4.6 |
| E-9 | 2026-09-10 | Three-way match via new PO + GRN tables; partial bills OK; results persisted | §2 E-9, §3.4–§3.8, §4.7 |
| E-10 | 2026-09-10 | Match tolerance is a company setting, default 0; no settings API. **Superseded by E-26.** | §2 E-10, §3.15 |
| E-11 | 2026-09-10 | Statement reconciliation: E matches structured lines; B ingests documents | §2 E-11, §3.13, §5.3 |
| E-12 | 2026-09-10 | Bill/payment RPCs post the JE (like C/D); no bespoke AP JE threshold. **Issue gate superseded by E-28.** | §2 E-12, §4.2–§4.3 |
| E-13 | 2026-09-10 | Undo reuses `reverse_journal_entry`; void needs `void_reason` | §2 E-13, §4.1 |
| E-14 | 2026-09-10 | `bill_status` live state is `issued`, not `approved`; no overdue cron. **`pending_approval` added by E-28.** | §2 E-14, §4.1 |
| E-15 | 2026-09-10 | `journal_entry_type`: `purchase_invoice` / `supplier_payment` / `supplier_advance` / `supplier_advance_application` / `grni_accrual` | §2 E-15, §3.16 |
| E-16 | 2026-09-10 | `BILL-YYYY-NNNN` at Issue; `PO-` / `GRN-` at create | §2 E-16, §3.2, §3.4, §3.6 |
| E-17 | 2026-09-10 | Bill lines mirror invoice lines (VAT, discounts, `5060`); `account_id` required at Issue | §2 E-17, §3.3, §4.2 |
| E-18 | 2026-09-10 | `payment_terms_type` + server-derived `due_date` at Issue | §2 E-18, §3.1–§3.2 |
| E-19 | 2026-09-10 | Draft/matched editable; issued locked; totals never client-set | §2 E-19, §4.1 |
| E-20 | 2026-09-10 | Payment blocked unless `matched` or `no_po` (Rules §1.5); Issue still allowed. **Override added by E-25.** | §2 E-20, §4.3, §4.5 |
| E-21 | 2026-09-10 | Period-end GRNI accrual to `2020`; receipts themselves do not post; no silent cron | §2 E-21, §3.14, §4.8 |
| E-22 | 2026-09-10 | Statement match: reference+amount, else amount ± 7 days; user confirms | §2 E-22, §5.3 |
| E-23 | 2026-09-13 | Supplier advances = `1350` Supplier Advances, not `1320`; COA extended to 184 accounts | §2 E-23, §4.5, §5.1 |
| E-24 | 2026-09-13 | GRNI accrual is in this pass (confirms E-21); required by Rules §1.22 close checklist | §2 E-24, §4.8 |
| E-25 | 2026-09-13 | Match-failure payment block with Owner override + mandatory reason; do not flip `match_status` | §2 E-25, §3.2, §4.3, §4.7 |
| E-26 | 2026-09-13 | Split tolerance: qty 0%, price 2%; two `company_settings` columns; no settings API | §2 E-26, §3.15, §4.7 |
| E-27 | 2026-09-13 | Statement window stays 7 calendar days (confirms E-22) | §2 E-27, §5.3 |
| E-28 | 2026-09-13 | AED 50,000 gate at bill Issue via `journal_approval_threshold`; payment not re-gated; partials inherit | §2 E-28, §4.1–§4.3 |
