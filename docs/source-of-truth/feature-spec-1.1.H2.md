# Module 1.1.H2 — Extended Financial Reports (H-remainder)
## Feature Specification (Ratified 2026-09-19)

Part of Module 1.1 · AI-Based Accounting Foundation, inFINity Phase 1 (MVP).
This is the scope document for Module 1.1.H2 only — the second half of
Module H. Module 1.1.H1 (`feature-spec-1.1.H1.md`) remains the
authoritative rule set for period Trial Balance, as-of Balance Sheet,
single-period Profit & Loss, and General Ledger — do not re-derive
those from this document.

**Status: ✅ Implemented 2026-09-20.** Decisions H2-1…H2-8 are built
(SQL + Nest + integrity sweep). H2-9…H2-13 are schema-verification
grounding. H2-14 is the owner sales-account / CN-netting rule. H2-15
(2026-09-20) corrects H2-14's amount basis from gross `line_total` to
ex-VAT line net. No H2-numbered decisions remain open.

This spec follows the same numbered-decision discipline A/C/D/E/F/G
used: once written, nothing is silently edited — append H2-N+.

**Grounding used for H2-9…H2-13:** `docs/source-of-truth/schema.sql`
(accounts, invoices, invoice_status, invoice_lines, credit_notes,
H1 report RPCs, G-37 `summarize_free_zone_income`),
`seed_finalized_coa_demo_company_0002.sql`, `feature-spec-1.1.C.md`,
`feature-spec-1_1_D.md` §5, `feature-spec-1_1_G.md` G-24/G-37,
`src/reports/reports.controller.ts`,
`src/common/controller-auth-coverage.spec.ts` (212 guarded routes at
ratification; live inventory is **218** after six H2 GETs).

**Build Order context:** per `Module_1.1_Build_Order_Scope.md` §8,
Extended Financial Reports is sequenced last. C–G are built. H2-1…H2-8
are implemented (2026-09-20); H2-15 is the line-net correction on H2-5.

---

## 0. Scope split — what H1's open table actually contains

`feature-spec-1.1.H1.md`'s "Module H — open (H remainder)" table lists
sixteen items, H-R1…H-R16. This spec does not attempt all sixteen in
one pass — some are genuinely a reporting decision (this spec's job);
others are blocked on infrastructure or data this codebase doesn't
have yet (a different kind of decision, usually an owner/schema one,
not a reporting-rule one). Splitting them up front, the same way G-25
scoped its adjustment list rather than trying to build the whole UAE
CT adjustment code in one pass:

| H-R# | Deliverable | This pass? | Closed by |
|---|---|---|---|
| H-R1 | P&L prior-period comparison | **Yes** | H2-1 |
| H-R11 | Comparative periods, any two side-by-side | **Yes** — same mechanism as H-R1 | H2-1 |
| H-R3 | TB for a calendar range that isn't a period row | **Yes** | H2-2 |
| H-R12 | Custom date range on every report incl. TB | **Yes** — H2-2 closes the TB half; P&L/GL/BS-as-of were already free-date in H1 | H2-2 |
| H-R5 | GL pagination | **Yes** | H2-3 |
| H-R9 | Expense analysis with MoM trend | **Yes** | H2-4 |
| H-R6 | Sales by customer | **Yes** | H2-5 / H2-13 / H2-14 |
| H-R10 | Executive summary snapshot | **Yes** — pure composition of existing reports | H2-6 |
| H-R13 | Export PDF / XLSX / CSV | **Partial** — CSV only this pass | H2-7 |
| H-R16 | Audit-ready pack, all statements for a period | **Yes** — built on H2-2/H2-7 | H2-8 |
| H-R2 | BS UAE standard presentation layout | **No** — see §7 | — |
| H-R4 | Statement of Cash Flows | **No** — see §7 | — |
| H-R7 | Sales by product/service | **No** — see §7 | — |
| H-R8 | Sales by salesperson | **No** — see §7 | — |
| H-R14 | Scheduled email delivery | **No** — see §7 | — |
| H-R15 | Accountant share link | **No** — see §7 | — |

Eight items close this pass. Six stay open, plus the PDF/XLSX half of
H-R13 — each with a specific reason in §7, not a blanket "later."

---

## 1. Decision log

### H2-1 — Comparative reporting is one generalized mechanism, not two features

**Decision:** H-R1 ("P&L prior-period comparison") and H-R11
("comparative periods, any two side-by-side") are the same underlying
request — run the existing single-period `get_profit_and_loss` logic
twice, over two caller-supplied date ranges, and return both results
plus a variance column. Building them as two separate features would
mean two code paths computing the same signed-balance arithmetic
(`account_signed_balance`, lockstep with `create_year_end_closing_entry`
per H1 decision #3) that could drift from each other — the same
reasoning H1 #2 used to reject a shadow running-balance column.

**Shape:** `get_profit_and_loss_comparison(p_company_id,
p_period_a_start, p_period_a_end, p_period_b_start, p_period_b_end)` —
returns two account arrays (period A, period B) plus a
`variance = period_a.balance − period_b.balance` per account, and
`total_income` / `total_expense` / `net_profit` for each period plus
their variances. "Prior period" (H-R1's literal ask) is a Nest-layer
convenience, not a new SQL code path: given period A's dates, Nest
computes period B as the immediately preceding period of the same
length (a month before a month, a quarter before a quarter) and calls
the same RPC. `GET /reports/profit-and-loss-comparison
?company_id=&period_a_start=&period_a_end=&period_b_start=&period_b_end=`,
with `period_b_start` / `period_b_end` optional — omitted means "prior
period of the same length," present means the caller picked arbitrary
period B (closing H-R11).

**Why not extend `get_profit_and_loss` itself:** the same reasoning
G-1 used for keeping CT provision posting out of the year-end RPC —
a second, optional comparison mode folded into the existing
single-period function risks every future single-period P&L change
needing to reason about the comparison branch too. A parallel
function that calls the existing one internally (or duplicates its
CTE structure with an extra join) keeps H1's `get_profit_and_loss`
untouched.

**Schema (H2-9):** `get_profit_and_loss(uuid, date, date)` is
`RETURNS TABLE` / `language plpgsql` / `STABLE` / `SECURITY INVOKER`
(`schema.sql` ~9685). A new function **can** `SELECT * FROM
get_profit_and_loss(...)` — do that, do not copy the CTE. Two
call-site facts the comparison RPC must handle:

1. The existing function **omits zero-balance accounts** (`HAVING
   account_signed_balance(...) <> 0`). Period A and period B will
   not return the same `account_id` set — outer-join the two result
   sets on `account_id` and treat a missing side as 0.
2. It returns **per-account rows only**. `total_income` /
   `total_expense` / `net_profit` are computed today in Nest
   (`summarizeProfitAndLoss` in `reports.service.ts`), not in SQL.
   The comparison RPC may either return the two account arrays and
   let Nest summarize twice with that same helper, or sum
   `category = 'income'|'expense'` in SQL using the same formula
   (`net_profit = total_income − total_expense`). Do not invent a
   third total.

**Not in scope:** Balance Sheet comparison (as-of X vs as-of Y). The
product-list items (H-R1, H-R11) are both phrased around P&L; a BS
comparison wasn't asked for and isn't added speculatively, matching
this spec-family's general posture (§0.4-style discipline in G) of not
inventing beyond the named deliverable.

### H2-2 — Trial Balance for an arbitrary date range, alongside the existing period-bounded route

**Decision:** H1 #1's `get_trial_balance_for_period` stays exactly as
it is — `period_id`-bounded, unchanged. H-R3/H-R12 (TB for a calendar
range that isn't an `accounting_periods` row) is closed by a second
function, `get_trial_balance_for_range(p_company_id, p_range_start,
p_range_end, p_include_zero_balance default false)`, reusing H1 §3's
exact opening/closing definitions but keyed on caller-supplied dates
instead of a period row: opening = ledger-truth lines strictly before
`p_range_start`; period activity = ledger-truth lines in
`[p_range_start, p_range_end]` inclusive; same signed-balance
convention. `GET /reports/trial-balance-range?company_id=&range_start=
&range_end=&include_zero_balance=`.

**Why a second function instead of making `period_id` optional on the
existing one:** the existing route's contract (`assertPeriodUsableForCompany`,
required `period_id`) is depended on by H1's own integrity sweep
(§7.1) and by anything already built against it. Changing its
signature risks the kind of drift G-32 had to correct for
(`create_year_end_closing_entry`'s live signature already differing
from an earlier spec draft) — a new, additive function avoids
touching a contract other tests already assert against.

**Schema (H2-10):** there is **no** report-index RPC or Nest route.
Callers of `get_trial_balance_for_period` are:

- `GET /reports/trial-balance` (`reports.controller.ts` — required
  `period_id` + `assertPeriodUsableForCompany`)
- H1 integrity sweep + `reports.trial-balance-cnl-coload.integration.spec.ts`
- `AccountsService.getTrialBalance` is a **different** helper (single
  account from `v_trial_balance`), not this RPC

Adding `GET /reports/trial-balance-range` is additive. Guarded HTTP
inventory is **212** routes (`controller-auth-coverage.spec.ts`).
Build must append the new path there.

### H2-3 — General Ledger pagination, additive and backward-compatible

**Decision:** H1 §5a explicitly deferred GL pagination ("revisit if
production companies produce unacceptable response sizes"). Closing
H-R5: add optional `p_limit` / `p_offset` parameters to
`get_general_ledger`, defaulting to `null` / `0` — an unpaginated call
behaves exactly as it does today (full result set, no behavior
change for any existing caller or test). `GET /reports/general-ledger
?company_id=&account_id=&date_from=&date_to=&limit=&offset=`, both
optional. Response gains a `total_count` field (COUNT(*) over the
same filtered set, computed once) so a caller can page without a
second round trip.

**Running balance vs. pagination — must not regress H1's own rule:**
H1 §5a is explicit that running balance is a true cumulative value
that must **not** reset at a date-filter boundary. The same rule
applies here: `p_limit`/`p_offset` must not change which rows
*qualify* as prior activity for the running-balance window function —
only which of the qualifying, already-correctly-computed rows are
*returned*. Concretely: the running-balance window function computes
over the full ledger-truth + date-filtered set exactly as H1 defined
it; `LIMIT`/`OFFSET` is applied only in the outer, final SELECT. Get
this ordering wrong and a paginated page 2 would show a
running_balance that doesn't match what the unpaginated H1 route
already returns for the same rows — exactly the kind of report-vs-report
drift H1's cross-report integrity sweep (decision #6) exists to catch.

**Verification note (extends H1 §7.1's own table):** a new sweep case
— unpaginated GL call vs. the same call in pages of N — must produce
identical `running_balance` per row across the page boundary. Add
this to the existing integrity-sweep fixture rather than a new one,
per H1 decision #6's own "one shared fixture" posture.

**Schema (H2-11):** no `p_limit` / `p_offset` (and no keyset cursor)
exists on any report RPC or Nest list DTO today. Offset/limit stays
the H2 choice. Implementation constraint: `CREATE OR REPLACE` **cannot**
add parameters to `get_general_ledger(uuid, uuid, date, date)` in
place — a second overload would make PostgREST `rpc('get_general_ledger')`
ambiguous. Must `DROP FUNCTION get_general_ledger(uuid, uuid, date, date)`
then recreate with trailing `p_limit int default null, p_offset int
default 0`, and re-issue the §5.1 revoke/grant on the **new**
signature. Nest's current four-arg rpc call remains valid because
the extra args default. `total_count` is not a column of the current
`RETURNS TABLE` — adding it as a repeated column on every row, or
returning it only from Nest via a wrapper count, is an implementation
detail; do not invent a second RPC for the count.

### H2-4 — Expense analysis is a monthly-bucketed re-read of P&L, not a new ledger read

**Decision:** H-R9 ("expense analysis — spend by category with
month-over-month trend") is closed as `get_expense_analysis
(p_company_id, p_fiscal_year, p_category_breakdown default 'sub_category')`
— for each calendar month in the fiscal year, run H1's existing
period-P&L logic scoped to `category = 'expense'` only, grouped by the
COA's own `Sub-Category` field (confirmed present on every account in
the finalized COA — e.g. `Payroll`, `Occupancy`, `Professional Fees`,
`COGS`; see the Chart of Accounts inspection below) rather than by raw
account. Returns one row per (month, sub-category) plus a running
month-over-month delta. `GET /reports/expense-analysis?company_id=
&fiscal_year=`.

**Why sub-category, not raw account, and why that's a real decision
here, not a detail:** the module request says "spend by category" —
the COA already has a `Sub-Category` column for exactly this kind of
grouping (confirmed against the live COA: 5000s-Expenses accounts
carry sub-categories `COGS`, `Depreciation & Amortization`, `Finance
Costs`, `Marketing`, `Occupancy`, `Other Operating`, `Payroll`,
`Professional Fees`, `Tax Expenses`). Grouping by raw account (60+
5xxx accounts in this COA) would not read as "category" to a user;
grouping by the COA's own sub-category field reuses an existing,
already-curated classification rather than inventing a new one —
same reasoning G-24 used to reuse `4300`/`4310`/`4320` instead of a
new enum.

**Schema (H2-12):** `accounts.sub_category` is a live `text` column
(`schema.sql` ~197, nullable). Demo seed writes it on every expense
account. Distinct expense values:
`COGS`, `Payroll`, `Occupancy`, `Marketing`, `Professional Fees`,
`Depreciation & Amortization`, `Finance Costs`, `Tax Expenses`,
`Other Operating`. No hardcoded map and no new column.

`get_profit_and_loss` does **not** return `sub_category`. Expense
analysis joins `accounts` on `account_id` (or groups in its own
query). Fiscal-year window: `accounting_periods.fiscal_year` plus
`min(period_start)` / `max(period_end)` — same pattern as
`summarize_free_zone_income`. `companies.fiscal_year_start_month`
exists if a company has no periods for that year (then raise
`NO_PERIOD_FOR_FISCAL_YEAR`, do not invent calendar months).

### H2-5 — Sales by customer, from invoice data directly, not from the AR ledger

**Decision:** H1's own table already draws the distinction H-R6 needs:
*"Customer ledger is AR movements (D §5.1), not a sales report."*
H-R6 ("sales by customer") is closed as `get_sales_by_customer
(p_company_id, p_period_start, p_period_end)` — aggregates *invoice
revenue* (income-account invoice lines, matched the same way H1's P&L
matches income accounts) grouped by the invoice's customer, for
issued/sent/paid/etc. invoices in range (same non-draft/non-void
posture G-37 established for `summarize_free_zone_income`, for the
same reason: a draft invoice isn't a sale yet). Returns per-customer
total revenue, invoice count, and average invoice value.
`GET /reports/sales-by-customer?company_id=&period_start=&period_end=`.

**Why this is not just D's aged-receivables read repurposed:** aged
AR answers "what's owed," bucketed by age, drawn from open balances.
Sales-by-customer answers "who bought how much," drawn from revenue
recognized in a period, independent of whether it's been collected.
Building it as a view over AR ageing would conflate a
balance-sheet-side question with an income-statement-side one —
exactly the mixing H1's own scope boundary (§1) warns against for TB
vs. BS vs. P&L.

**Schema (H2-13):**

- Link: `invoices.customer_id uuid not null references customers(id)`
  (`schema.sql` ~1279). No product_id, no salesperson column.
- Status enum: `draft`, `issued`, `sent`, `viewed`, `partially_paid`,
  `paid`, `overdue`, `written_off`, `void`.
- Qualifying invoices: same filter as G-37 —
  `status not in ('draft', 'void')`. Includes `written_off` (revenue
  was recognized). Amount: `invoice_lines.line_total` (ex-VAT), dated
  by `invoices.invoice_date`.
- Income account: `invoice_lines.income_account_id` → `accounts`.
  Free-zone vs mainland is **account number**, not a line flag:
  `4300` qualifying FZ, `4310`/`4320` non-qualifying/mainland (G-24).
  COA `sub_category` on those three is `Free Zone Income`; 4000–4060
  is `Sales Revenue`; 4500+ is `Other Income` / `Investment Income`
  / `FX & Other`.
- `credit_notes` exist (`customer_id`, `original_invoice_id`,
  `credit_note_status` = `draft`/`issued`/`void`). G-37's FZ
  summarizer does **not** subtract them.

**Closed by H2-14 (owner business rule, not schema):** sales =
`sub_category = 'Sales Revenue'` union `4300`/`4310`/`4320` when
`is_free_zone_entity`; exclude Other/Investment/FX; net issued
credit-note lines on the same account set via
`credit_notes.customer_id`.

### H2-6 — Executive summary is composition, not a new calculation

**Decision:** H-R10 ("executive summary — one-page snapshot for a
selected period") is closed as a single Nest-layer endpoint,
**not a new SQL function**, that calls the existing `get_balance_sheet`,
`get_profit_and_loss`, `GET /reports/aged-receivables`, and
`GET /reports/aged-payables` for the same period/as-of-date and
returns their key totals in one payload (`total_assets`,
`total_liabilities`, `total_equity`, `is_balanced`, `net_profit`,
`total_ar_outstanding`, `total_ap_outstanding`, plus each report's own
link/params for drill-down). `GET /reports/executive-summary
?company_id=&period_start=&period_end=`.

**Why composition, not a new RPC:** every number in an executive
summary already exists behind an H1 or D/E route. A new SQL function
computing the same totals a second time is exactly the "second source
of truth that can drift" H1 #2 rejected for a running-balance column —
the same argument applies here at the Nest layer, not just the SQL
layer. Four internal calls in one Nest method keeps every number
provably equal to what the underlying report already returns, at the
cost of four round trips server-side instead of one query — an
acceptable trade for a summary endpoint that isn't on a hot path.

**Not in scope:** any narrative/AI-generated commentary on the
numbers. H1's own framing note (§18 "there is no UI in this
repository... PDF/XLSX layout... not built") applies here too — this
is data composition, not a rendered "snapshot."

### H2-7 — CSV export only this pass; PDF/XLSX explicitly deferred

**Decision:** H-R13 ("export PDF, Excel (XLSX), and CSV for all
reports") splits. **CSV closes this pass**: every H1 + H2 report route
above gains a sibling `?format=csv` (or a parallel `/csv` route —
Nest-layer convention, not a spec decision) that serializes the same
JSON response already computed, flattened to rows/columns, with a
`Content-Disposition: attachment` header. This is pure serialization
of numbers this codebase already computes correctly — no new
accounting logic, no layout decisions, no new failure surface beyond
"can this JSON flatten to a table," which every one of H1/H2's
account-row-shaped responses already can.

**PDF and XLSX stay out of scope for H2, for a different reason than
"not built yet":** unlike CSV, PDF/XLSX involve real design decisions
this spec has no basis to make — page layout, company letterhead/logo
placement, print pagination for a long TB, cell formatting/number
formatting conventions, whether XLSX ships as raw data or as a
styled workbook matching what an accountant would expect to hand to
an auditor. `feature-spec-1_1_G.md`'s own out-of-scope list makes the
same call for CT ("PDF/XLSX/CSV rendering mechanics generally — H-remainder,
mirrors F-9's split") — this spec inherits that split rather than
re-litigating it. A future H3 pass (or a dedicated design pass, closer
to how `frontend-design` guidance works for UI) should own PDF/XLSX
specifically.

### H2-8 — Audit-ready pack is a bundle of H1 + H2-2 + H2-7, not a new report

**Decision:** H-R16 ("audit-ready pack — one-click bundle of all
financial statements for a period") is closed as
`GET /reports/audit-pack?company_id=&period_id=` — calls H1's
`get_trial_balance_for_period`, `get_balance_sheet` (as-of
`period.period_end`), `get_profit_and_loss` (period start/end), and
`get_general_ledger` (unbounded by date, full account set) for the
same period, and returns all four as CSV attachments (via H2-7) in one
response — a zip, or four `Content-Disposition` parts, Nest-layer
implementation detail. Explicitly **not** `GET /reports/vat-audit-pack/:id`
(F-15) — that's VAT-specific; this is the financial-statement pack
H1's own table already distinguishes it from.

**Why this needs H2-2, not just H1's routes directly:** an
audit-ready TB for an arbitrary audit period should use the same
range logic as the rest of the pack (P&L/GL are already free-date in
H1); reusing H1's period-locked TB here would make the TB the only
part of the pack that can't match an arbitrary audit window — H2-2
exists partly to make this pack internally consistent.

**Not in scope:** cover page, table of contents, or any PDF assembly
— that's the deferred half of H2-7.

### H2-9 — Grounding: comparison calls `get_profit_and_loss` (closes H2-1 schema flag)

See H2-1 Schema paragraph. Callable as `SELECT * FROM
get_profit_and_loss(...)`. Outer-join zeros. Reuse Nest
`summarizeProfitAndLoss` (or the same formula in SQL). Do not copy
the CTE.

### H2-10 — Grounding: TB has no report-index surface (closes H2-2 schema flag)

See H2-2 Schema paragraph. Additive `GET /reports/trial-balance-range`
only. Guarded-route inventory is 212 today.

### H2-11 — Grounding: offset pagination; drop/recreate GL signature (closes H2-3 schema flag)

See H2-3 Schema paragraph. No other paginated RPC. Drop the four-arg
`get_general_ledger` before adding `p_limit`/`p_offset` defaults.

### H2-12 — Grounding: `accounts.sub_category` is a live column (closes H2-4 schema flag)

See H2-4 Schema paragraph. Join `accounts`; do not invent a category
map. FY window from `accounting_periods`.

### H2-13 — Grounding: `invoices.customer_id` + G-37 status filter (closes H2-5 schema flag)

See H2-5 Schema paragraph. Owner question H2-13a is **closed by
H2-14** (not a schema finding).

### H2-14 — Sales-by-customer account set and credit-note netting (closes H2-13a)

**Decision (owner business rule, 2026-09-19):** distinct in kind from
H2-9…H2-13, which only verified columns and RPC signatures. H2-14
picks the sales definition H2-13a left open.

**"Sales"** for `get_sales_by_customer` (H2-5) is invoice lines
posted to accounts where:

- `accounts.sub_category = 'Sales Revenue'`, **union**
- accounts `4300` / `4310` / `4320` when
  `companies.is_free_zone_entity = true` (G-24 reuses those three as
  a free-zone entity's sales revenue, not "other income").

Explicitly **excluded:** `accounts.sub_category IN ('Investment Income',
'Other Income', 'FX & Other')` — real income, not sales.

**Credit notes net** against the same customer and period:

```
sales_by_customer.total_revenue
  = SUM(invoice line_total, filtered as above)
  − SUM(credit_note line_total against the same customer,
        same sales-account set,
        same non-draft/void filter G-37 established)
```

Verified against `schema.sql` (not assumed): `credit_notes.customer_id
uuid not null references customers(id)` (~2335). Netting joins
`credit_note_lines` → `credit_notes` on `credit_note_id` and groups
by `credit_notes.customer_id`. `original_invoice_id` exists but is
not required for the customer join. Period date is
`credit_notes.credit_note_date`. Line income account is
`credit_note_lines.income_account_id` (same sales-account filter as
invoices). G-37 on this enum (`credit_note_status`: `draft` /
`issued` / `void`) is `status not in ('draft', 'void')`.

### H2-15 — Sales-by-customer amount is ex-VAT line net (corrects H2-14)

**Decision (correction, 2026-09-20):** not a new open question. H2-14's
account set, G-37 status filter, and CN netting via
`credit_notes.customer_id` stand. The amount basis does not.

H2-13/H2-14 named `invoice_lines.line_total` / `credit_note_lines.line_total`
and called it ex-VAT. Live `schema.sql` computes
`line_total := line_net + line_vat` (~939). VAT collected is a
liability (FTA), not revenue. `get_profit_and_loss` recognizes Sales
Revenue on the ledger's ex-VAT basis. H2-4 and H2-8 already assume
that same net basis for cross-report checks.

`get_sales_by_customer` must therefore sum **line net**, not `line_total`,
for the H2-14 sales-account set (`accounts.sub_category = 'Sales Revenue'`
UNION `4300`/`4310`/`4320` when `is_free_zone_entity`, excluding
Investment Income / Other Income / FX & Other), and net
credit-note line net against the same customer / period / status filter:

```
sales_by_customer.total_revenue
  = SUM(invoice line net, H2-14 account set, G-37 status, period)
  − SUM(credit_note line net, same account set, same filter, period)
```

**Schema (grounded, not a new column):** `invoice_lines` and
`credit_note_lines` have no stored `line_net` column — only
`line_total` (gross). Net is the existing helper
`line_net_amount(quantity, unit_price, discount_percent, discount_amount)`
(`schema.sql` ~7388), identical to `compute_*_line_amounts`'s `line_net`
OUT. Call that helper. Do not add a column and do not divide
`line_total` by (1 + vat_rate).

This closes the "Next Steps" note from the H2 implementation report
(sales-by-customer vs P&L Sales Revenue + FZ activity on the same
net basis). Integrity: summed `total_revenue` equals
`get_profit_and_loss` Sales Revenue (+ FZ 4300/4310/4320 when FZ)
for the same company/period — same cross-report posture as H2-4/H2-8.
Still do not assert equality to P&L `total_income` (other income /
investment / FX / manual JEs remain on the P&L).

---

## 2. Schema surface (additive — verified 2026-09-19 against live `schema.sql`; H2 RPCs built 2026-09-20)

No new tables. H1 functions unchanged except H2-3's GL drop/recreate.
H2 RPCs live:

```
get_profit_and_loss_comparison(...)     -- H2-1
get_trial_balance_for_range(...)        -- H2-2
get_expense_analysis(...)               -- H2-4
get_sales_by_customer(...)              -- H2-5; amount basis H2-15
get_general_ledger(..., p_limit, p_offset)  -- H2-3 (single 6-arg function)
```

| Object | Live signature | H2 change |
|---|---|---|
| `get_profit_and_loss` | `(uuid, date, date) RETURNS TABLE` plpgsql STABLE INVOKER | unchanged; H2-1 selects from it |
| `get_trial_balance_for_period` | `(uuid, uuid, boolean)` | unchanged |
| `get_general_ledger` | `(uuid, uuid, date, date)` | H2-3: drop + recreate with `p_limit int default null`, `p_offset int default 0` |
| `get_balance_sheet` | `(uuid, date)` | unchanged (H2-6/H2-8 compose) |
| `get_aged_receivables` / `get_aged_payables` | `(uuid, date)`; `is_totals` row | unchanged (H2-6 compose) |

H2-6 (executive summary) and H2-8 (audit pack) are Nest-layer
composition only — no new SQL functions. Nest already has
`summarizeBalanceSheet` / `summarizeProfitAndLoss`; aged reports
already return an `is_totals` row (`total` column) — H2-6 reads those,
it does not re-sum.

All new/changed functions: `SECURITY INVOKER`, revoke
`public`/`authenticated`/`anon`, grant `EXECUTE` to `service_role`
only (Module 1.1.A §5.1 / H1 same line). F-9 `export_vat_return`
returns `jsonb` `{csv: "..."}` on `GET /vat-returns/:id/export` — that
is **not** a generic H exporter; H2-7 is new Nest serialization.

---

## 3. HTTP surface

All new routes: `SupabaseAuthGuard` + `CompanyMembershipGuard` with
`@RequireCompanyMembership({ type: 'query' })` — same as every H1
route (H1 §6.5). Non-members → 403.

| Route | Decision |
|---|---|
| `GET /reports/profit-and-loss-comparison` | H2-1 |
| `GET /reports/trial-balance-range` | H2-2 |
| `GET /reports/general-ledger` (extended: `limit`, `offset`) | H2-3 |
| `GET /reports/expense-analysis` | H2-4 |
| `GET /reports/sales-by-customer` | H2-5 |
| `GET /reports/executive-summary` | H2-6 |
| `?format=csv` on every H1 + H2 report route above | H2-7 |
| `GET /reports/audit-pack` | H2-8 |

Auth route count: guarded HTTP inventory is **218**
(`controller-auth-coverage.spec.ts`) after the six H2 GET routes.

---

## 4. Verification notes (extends H1 §7 — same fixture family, not a new one)

- H2-1: period A vs. period B on the same multi-period fixture H1 §7.1
  already uses; variance = A − B, sign-consistent with each account's
  `normal_balance`.
- H2-2: `get_trial_balance_for_range` over an exact period's
  `[period_start, period_end]` must equal `get_trial_balance_for_period`
  for the same period — the two functions computing the same period
  must agree, or H2-2 has a bug.
- H2-3: paginated GL (limit 10, walked page by page) must reconstruct
  the exact same row set and `running_balance` values as the
  unpaginated call, in the same order.
- H2-4: sum of all sub-category monthly totals for a fiscal year must
  equal `get_profit_and_loss`'s `total_expense` for that fiscal year —
  cross-report agreement, same posture as H1 decision #6.
- H2-5: after H2-14 + H2-15, sum of customers' `total_revenue` equals
  invoice line net on the H2-14 account set minus credit-note line net
  on the same set, same G-37 status filter, same dates — and equals
  `get_profit_and_loss` Sales Revenue (+ FZ 4300/4310/4320 when FZ)
  for that company/period. **Do not** assert equality to P&L
  `total_income` (other income / investment / FX / manual JEs remain
  on the P&L).
- H2-8: TB/BS/P&L totals inside the audit pack must match calling H1's
  own routes directly for the same period/company — the pack is a
  bundle, not a recomputation.

---

## 5. Out of scope for this pass, and why (not a blanket deferral)

- **H-R2 — BS UAE standard presentation layout.** The live COA has no
  current/non-current classification on any asset or liability account
  (confirmed by inspection: sub-categories are things like `Fixed
  Assets`, `Receivables`, `Borrowings`, `Other Liabilities` — none of
  which map to current/non-current without a judgment call per
  account, e.g. is a `Borrowings` account current or non-current?
  Depends on the specific loan's maturity, not the account itself). A
  UAE-standard layout needs either a new per-account presentation tag
  or a per-transaction maturity field — a schema decision, not a
  reporting-rule decision, and needs owner input the same way G-3
  needed COA confirmation before CT could post anywhere.
- **H-R4 — Statement of Cash Flows.** Never designed, and for a real
  reason: both the direct and indirect methods need a cash-movement
  categorization (operating / investing / financing) attached to each
  cash-touching transaction, which doesn't exist in this schema today.
  This is exactly the kind of "needs its own dedicated pass" item
  G-1's reasoning was written for (a conceptually distinct feature
  large enough that folding it into this spec risks under-scoping it
  the way folding CT into year-end close would have). Recommend a
  dedicated H3/cash-flow spec, grounded against `schema.sql` and the
  Accounting Rules PDF, the same way G was grounded against CT law.
- **H-R7 — Sales by product/service.** `invoice_lines` has
  `description` and `is_service boolean` only — no product catalog
  (C follow-up, Build Order §2). Grouping by `is_service` would be
  inventing a product report from a VAT-line flag; declined.
- **H-R8 — Sales by salesperson.** No salesperson column on
  `invoices` or `invoice_lines`. `company_members` is auth membership,
  not a sales-owner field.
- **H-R14 — Scheduled email delivery.** No mailer in this repository
  (no nodemailer/SendGrid/etc.). Recurring cron is ledger/VAT jobs,
  not report email.
- **H-R15 — Accountant share link.** `company_role` includes
  `accountant` and `external_accountant`, but that is JWT
  `company_members` membership — not a tokenized read-only URL.
  Share-link auth (scoping, expiry, revocation, bypass of
  `CompanyMembershipGuard`) needs its own security pass.
- **PDF / XLSX rendering (half of H-R13).** See H2-7 — deferred for
  design-decision reasons, not effort reasons.

---

## 6. Decision Log Index

| # | Summary | Detail in |
|---|---|---|
| H2-1 | P&L comparison, generalized mechanism closes H-R1 + H-R11 together | §1 H2-1 |
| H2-2 | Trial Balance for an arbitrary date range, additive alongside period-bounded TB | §1 H2-2 |
| H2-3 | GL pagination, additive params, running-balance correctness preserved across pages | §1 H2-3 |
| H2-4 | Expense analysis by COA sub-category, monthly buckets, re-reads P&L | §1 H2-4 |
| H2-5 | Sales by customer from invoice revenue, not AR ledger | §1 H2-5 |
| H2-6 | Executive summary as Nest-layer composition of existing reports, no new SQL | §1 H2-6 |
| H2-7 | CSV export closes this pass; PDF/XLSX deferred as a design decision | §1 H2-7 |
| H2-8 | Audit pack bundles H1 + H2-2 + H2-7, no new computation | §1 H2-8 |
| H2-9 | Grounding: comparison `SELECT * FROM get_profit_and_loss` | §1 H2-9 |
| H2-10 | Grounding: no TB report index; additive range route | §1 H2-10 |
| H2-11 | Grounding: offset pagination; drop/recreate GL signature | §1 H2-11 |
| H2-12 | Grounding: `accounts.sub_category` is a live column | §1 H2-12 |
| H2-13 | Grounding: `invoices.customer_id` + G-37 status; H2-13a closed by H2-14 | §1 H2-13 |
| H2-14 | Owner rule: sales = Sales Revenue ∪ FZ 4300/4310/4320; CNs net via `credit_notes.customer_id` | §1 H2-14 |
| H2-15 | Correction: sales amount is ex-VAT line net (`line_net_amount`), not gross `line_total` | §1 H2-15 |

---

## 7. Implemented — no open residuals

H2-9…H2-13 are schema verification. H2-14 is the owner account-set
rule. H2-15 (2026-09-20) corrects H2-14's amount basis to ex-VAT line
net. No H2-numbered entries remain open.

H2-1…H2-8 are implemented. Guarded HTTP inventory is **218** routes
(`controller-auth-coverage.spec.ts`).

Deferred **out of this pass** (not open H2 questions): H-R2 BS UAE
layout, H-R4 cash flow, H-R7/H-R8 product/salesperson, PDF/XLSX
(half of H-R13), H-R14 scheduled email, H-R15 share link. See §5.