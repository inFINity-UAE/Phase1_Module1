# Module 1.1.H — Financial Reports
## Feature Specification (Source of Truth)

Part of Module 1.1 · AI-Based Accounting Foundation, inFINity Phase 1 (MVP).
This is the authoritative feature list for **Module H** (core + extended
reports).

**Status: ✅ Built.** H1 core signed off 2026-08-30 (decisions #1–#6).
Full Module H inventory is #7 (2026-09-19), standing-updated #8
(2026-09-20). Extended reports H2-1…H2-15 implemented 2026-09-20.
No H2-numbered decisions remain open.

**Merged 2026-09-21** from `feature-spec-1.1.H1.md` and
`feature-spec-1.1.H2.md` (decision #9). Numbered decision *bodies* were
not rewritten. IDs stay **#1–#8** (H1 core / inventory) and **H2-1…H2-15**
(extended). The former `feature-spec-1.1.H1.md` / `feature-spec-1.1.H2.md`
files were removed (#10); this file is the only Module H spec.

There is **no UI** in this repository. "Completed" means HTTP + RPC
data. PDF/XLSX layout, email, and share links are not built. CSV on
the H1 four routes plus H2 report routes is built (H2-7).

**How to use this document:**

- The standing inventory below is the current Module H picture.
- **Part I (§1–§8)** is the H1 rule set for period Trial Balance, as-of
  Balance Sheet, single-period Profit & Loss, and General Ledger
  (unpaginated contract; pagination is additive H2-3). Do not invent
  cash-flow formulas, sales-mix logic, or PDF/XLSX layouts from Part I.
- **Part II (§9–§16)** is the H2 rule set (H2-1…H2-15). Do not re-derive
  H1 TB/BS/P&L/unpaginated-GL contracts from Part II.
- Decision log indexes are at §8 (H1) and §15 (H2). When a rule changed
  after it was first logged, the standing section states the *current*
  rule — the superseded version lives in the log.

Module 1.1.A (`feature-spec.md`, `schema.sql`) remains the engine
prerequisite. Module H adds reporting reads only — no new tables, no
transactional workflow changes. Aged AR/AP reads were added later by
D and E on `/reports/*`; they are not H1/H2 decisions.

### Module H — completed

| Deliverable | Status | Evidence |
|---|---|---|
| Profit & Loss for any date range (month / quarter / year / custom) | **Completed** (#3) | `get_profit_and_loss` · `GET /reports/profit-and-loss?period_start=&period_end=` |
| Balance Sheet at any date — assets, liabilities, equity (signed balances + `is_balanced`) | **Completed** (#2) | `get_balance_sheet` · `GET /reports/balance-sheet?as_of_date=` |
| Trial Balance — all accounts with opening and closing debit/credit | **Completed** (#1) | `get_trial_balance_for_period` · `GET /reports/trial-balance?period_id=` |
| General Ledger — transaction listing by account and date range (running balance; this is the drill-down surface) | **Completed** (#5; pagination H2-3) | `get_general_ledger` · `GET /reports/general-ledger` |
| Aged Receivables with per-customer rows (drill via customer ledger / statement data) | **Completed** (D §5.1–§5.2) | `GET /reports/aged-receivables`, `/customer-ledger`, `/customer-statement` |
| Aged Payables with per-supplier rows (drill via supplier ledger / bills-due) | **Completed** (E §5.1–§5.2) | `GET /reports/aged-payables`, `/supplier-ledger`, `/bills-due` |
| Custom date range on P&L and GL; BS as-of any date | **Completed** (#2 / #3 / #5) | Arbitrary `period_start`/`period_end`, `date_from`/`date_to`, `as_of_date` |
| Cross-report integrity (TB / BS / P&L / GL) | **Completed** (#6) | `reports.h1-integrity-sweep.integration.spec.ts` |
| P&L comparison (prior or any two ranges) | **Completed** (H2-1) | `get_profit_and_loss_comparison` · `GET /reports/profit-and-loss-comparison` |
| Trial Balance for a caller date range | **Completed** (H2-2) | `get_trial_balance_for_range` · `GET /reports/trial-balance-range` (`GET /reports/trial-balance` stays `period_id`) |
| General Ledger pagination (`limit`/`offset`; running balance over the full set) | **Completed** (H2-3) | `get_general_ledger` 6-arg · `GET /reports/general-ledger` |
| Expense analysis by COA `sub_category`, month-over-month | **Completed** (H2-4) | `get_expense_analysis` · `GET /reports/expense-analysis` |
| Sales by customer (Sales Revenue ∪ FZ 4300/4310/4320; CN net; ex-VAT line net) | **Completed** (H2-5 / H2-14 / H2-15) | `get_sales_by_customer` · `GET /reports/sales-by-customer` |
| Executive summary (Nest composition of BS / P&L / aged AR / AP) | **Completed** (H2-6) | `GET /reports/executive-summary` |
| CSV export (`?format=csv`) on H1 four + H2 report routes | **Completed** (H2-7) | Nest interceptor — not D/E/F reports |
| Financial-statement audit pack (zip of TB/BS/P&L/GL CSVs for a `period_id`) | **Completed** (H2-8) | `GET /reports/audit-pack` |

### Module H — remaining

H2-1…H2-15 closed H-R1, H-R3, H-R5, H-R6, H-R9, H-R10, H-R11, H-R12,
CSV of H-R13, and H-R16. Do not implement the rows below from this
table alone — they need their own spec against the Accounting Rules
PDF and `schema.sql`.

| # | Deliverable | Why remaining |
|---|---|---|
| H-R2 | Balance Sheet **UAE standard presentation layout** | H1 returns JSON by `category` (asset/liability/equity). No FTA/layout pack, no UI. Needs per-account current/non-current. |
| H-R4 | Statement of Cash Flows — **direct and indirect**, auto from ledger | Never designed. Needs cash categorization not in H or A. |
| H-R7 | Sales by **product / service** | No product catalog (C follow-up in Build Order §2). Invoice lines have description / `is_service` only. |
| H-R8 | Sales by **salesperson** | No salesperson / owner entity on invoices. |
| H-R13 | Export **PDF and Excel (XLSX)** | CSV closed by H2-7 on H1 four + H2 report routes. PDF/XLSX still not built. F-9 VAT CSV and D statement **data** are separate. |
| H-R14 | Scheduled delivery — auto-email PDF weekly / monthly / quarterly | Not built. No mailer. Recurring cron is ledger/VAT jobs, not report email. |
| H-R15 | Accountant share link — read-only report access for an external firm | Not built. Auth is company membership JWT only. |

Closed H1 engineering items (not product-list gaps):

| Gap | Status | Detail |
|---|---|---|
| Cross-report integrity sweep | **Closed (#6)** | TB / BS / P&L / GL agree on multi-period + reverse + YE fixture |
| `v_trial_balance` status/join alignment | **Closed (A #60)** | View uses `is_ledger_truth_status` |
| YE P&L aggregation vs reversals | **Closed (A #61 / H1 #6)** | `create_year_end_closing_entry` uses `is_ledger_truth_status` |

---

# Part I — Core reports (H1 decisions #1–#8)

## 1. Scope boundary

In scope for H1:

- **Period Trial Balance** via `get_trial_balance_for_period` and
  `GET /reports/trial-balance` *(decision #1)*
- **Balance Sheet as of a date** via `get_balance_sheet` and
  `GET /reports/balance-sheet` *(decision #2)*
- **Single-period Profit & Loss** via `get_profit_and_loss` and
  `GET /reports/profit-and-loss` *(decision #3)* — arbitrary date range;
  **no** prior-period comparison
- **General Ledger** via `get_general_ledger` and
  `GET /reports/general-ledger` *(decision #5)* — line-level listing with
  per-account running balance; **not** an account-level aggregate
- **Cross-report integrity sweep** *(decision #6)* — single multi-period
  fixture proving TB / BS / P&L / GL agree with each other and with
  `journal_lines` after reverse + year-end close

Out of scope **for H1**: every other report and every presentation/delivery
feature listed under build-order §1 deferred / §8, including comparative
periods and GL pagination (explicitly deferred in #5). Standing #8:
those two, plus range TB / expense MoM / sales-by-customer / executive
summary / CSV / audit pack, shipped in Part II (H2-1…H2-8) — they
remain out of Part I's original H1 rule set; do not re-derive H1
TB/BS/P&L/unpaginated-GL contracts from Part II.

---

## 2. Ledger-truth status (all H1 reporting reads)

*(Decision #4)*

Every H1 reporting function filters parent `journal_entries` through
**`is_ledger_truth_status(status)`** — true only for `posted` and
`reversed`. **`draft` / `pending_approval` / `rejected` never
contribute.**

Used by: `get_trial_balance_for_period`, `get_balance_sheet`,
`get_profit_and_loss`, `get_general_ledger`.

**Also on this predicate:** `v_trial_balance` (`schema.sql` §9) as of
Module 1.1.A **decision #60**.

---

## 3. Period Trial Balance — opening and closing definition

*(Decision #1, updated #4)*

For a selected `accounting_periods` row belonging to `p_company_id`:

| Figure | Definition |
|---|---|
| **Opening** | Sum of all **ledger-truth** `journal_lines` whose parent has `entry_date` **strictly before** `period.period_start` |
| **Period activity** | Sum of all **ledger-truth** lines with `entry_date` in **`[period_start, period_end]` inclusive** |
| **Closing** | Opening amounts + period activity amounts (debit and credit independently); signed closing balance = opening signed balance + period net under the same `normal_balance` convention as `v_trial_balance` |

Signed balances (`opening_balance`, `closing_balance`) use:

- `normal_balance = debit` → debit − credit  
- `normal_balance = credit` → credit − debit  

Same convention as `schema.sql` §9 `v_trial_balance`.
Status filter: **`is_ledger_truth_status`** (#4).

Default result set (`p_include_zero_balance = false`): omit accounts with
no opening debit/credit and no period debit/credit. When
`p_include_zero_balance = true`, return every company account (typically
zero rows of activity still appear as zeros).

---

## 4. Balance Sheet — as-of definition

*(Decision #2, updated #4)*

A Balance Sheet is **life of the company to date X**, not period activity.
It is **not** period-bounded like Trial Balance.

For `p_company_id` and `p_as_of_date`:

| Rule | Definition |
|---|---|
| **Included accounts** | `category IN ('asset', 'liability', 'equity')` only |
| **Excluded accounts** | `income` and `expense` never appear — their year-end effect is folded into Retained Earnings via `create_year_end_closing_entry` (Module 1.1.A §4.4 / §6) |
| **Included lines** | Parent passes **`is_ledger_truth_status`** and `entry_date <= p_as_of_date` |
| **Signed balance** | Same `normal_balance` convention as `v_trial_balance` / decision #1 |

**Why `reversed` is included:** See §2.

Zero-balance A/L/E accounts are omitted from the account list (signed
`balance = 0`, including fully reversed activity); summary totals are
still computed (empty → zeros).

### 4.1 Summary totals

Alongside account rows, the HTTP response always includes:

- `total_assets`, `total_liabilities`, `total_equity` — sums of signed
  `balance` by category
- `is_balanced` — `true` iff `total_assets = total_liabilities + total_equity`
  (money-rounded). A `false` on real data is an engine/report sanity
  signal, not decoration.

Until year-end close, open P&L activity that hit cash/bank (etc.) without
a closed RE offset can leave `is_balanced = false` — expected mid-year;
not an exception from the equation itself.

---

## 5. Profit & Loss — period definition

*(Decision #3, updated #4)*

A P&L is **inherently period-bounded** — **ledger-truth** activity with `entry_date` in
`[p_period_start, p_period_end]` inclusive. It is **not** cumulative like
the Balance Sheet. The date range may be any calendar span (month,
quarter, partial year, full year) — not only fiscal-year-aligned windows.

| Rule | Definition |
|---|---|
| **Included accounts** | `category IN ('income', 'expense')` only |
| **Included lines** | Parent passes **`is_ledger_truth_status`** and `entry_date` in range |
| **Signed balance** | Via shared SQL helper `account_signed_balance` — **identical** to `create_year_end_closing_entry` (Module 1.1.A §9b) |
| **net_profit** | `total_income − total_expense` where each total is the sum of signed balances by category — same arithmetic as YE’s `v_total_debits − v_total_credits` before the RE transfer |

**Lockstep with year-end close (mandatory):** This report’s
`net_profit` for a date range that covers a fiscal year’s P&L activity
must equal the net amount `create_year_end_closing_entry` posts to
account **3100 Retained Earnings** for that year (credit if profit,
debit if loss). Both paths use `account_signed_balance`. If YE’s
balance-direction logic ever changes, **update this report in the same
change** — silent drift would be a credibility failure the first time
someone runs both. That coupling is why this decision exists in the log.

**Explicitly out of scope here:** prior-period comparison (monthly /
quarterly / annual *with* comparison) — deferred to Extended Reports
(H2) per build-order §1.

Zero signed-balance income/expense accounts are omitted; empty range →
zeros, not an error. `period_end < period_start` is rejected (Nest 400;
DB raises `INVALID_PERIOD_RANGE` as backstop).

---

## 5a. General Ledger — line listing and running balance

*(Decision #5)*

Unlike H1-1/H1-2/H1-3 (account-level aggregates), the General Ledger is a
**transaction listing**: one result row per `journal_lines` entry whose
parent passes **`is_ledger_truth_status`**, joined to `journal_entries`
for `entry_number` / `entry_date` / `narration` / `status`.

| Rule | Definition |
|---|---|
| **Row grain** | One row per journal line (not per account) |
| **Included lines** | Parent status passes **`is_ledger_truth_status`** (`posted` ∪ `reversed`) |
| **Excluded** | `draft` / `pending_approval` / `rejected` never appear |
| **Filters** | `p_account_id` null = all accounts; `p_date_from` / `p_date_to` null = unbounded in that direction |
| **Order** | `account_number`, `entry_date`, `entry_number`, `line_number` |
| **line_balance** | `account_signed_balance(normal_balance, debit, credit)` |
| **running_balance** | Cumulative sum of `line_balance` **partitioned by account**, ordered as above |

### Running balance and date filters (explicit rule)

**Running balance always carries the true opening balance** from activity
before the filtered window. Date filters only control which rows are
*returned*; they do **not** reset the running balance to zero at
`date_from`.

Rationale: a General Ledger’s defining feature is the true cumulative
balance per account. Resetting inside a date window would produce a
window-relative subtotal that does not match `v_trial_balance` and would
mislead drill-down from an as-of Balance Sheet / Trial Balance. The last
row of an account-filtered, date-unbounded query must equal that
account’s `v_trial_balance.balance`.

### Pagination

**Deferred this pass.** Matching Module 1.1.A list routes
(`GET /accounts`, `GET /journal-entries` — feature-spec.md §4.5/§4.6),
this endpoint returns the full filtered result set with no
limit/offset/cursor. Revisit if production companies produce
unacceptable response sizes.

### Account filter same-company check

When `account_id` is supplied, Nest validates it belongs to `company_id`
via `assertAccountBelongsToCompany` (same-company pattern from
Module 1.1.A §4.8 / decision #35 company-match half). Inactive accounts
are allowed (historical GL). RPC raises `ACCOUNT_COMPANY_MISMATCH` as
backstop. Inverted `date_to < date_from` → Nest 400 /
`INVALID_DATE_RANGE`.

---

## 5. Database surface

### 5.1 Shared helpers *(#3 / #4)*

**`is_ledger_truth_status(p_status)`** — `posted` ∪ `reversed`.

**`account_signed_balance(...)`** — P&L / year-end / GL signed balance
(lockstep with `create_year_end_closing_entry`; update together if YE
logic changes).

### 5.2 Trial Balance function *(#1 / #4)*

`get_trial_balance_for_period(...)` — opening and period CTEs use
`is_ledger_truth_status`.

### 5.3 Balance Sheet function *(#2 / #4)*

`get_balance_sheet(...)` — matched_lines CTE uses
`is_ledger_truth_status`.

### 5.4 Profit & Loss function *(#3 / #4)*

`get_profit_and_loss(...)` — matched_lines CTE uses
`is_ledger_truth_status`.

### 5.5 General Ledger function *(#5)*

`get_general_ledger(p_company_id, p_account_id default null,
p_date_from default null, p_date_to default null)` — line-level; window
function for running balance over all ledger-truth lines, then date
filter on the outer SELECT.

### 5.6 Security and grants

All reporting functions and shared helpers:

- **`SECURITY INVOKER`** (not DEFINER)
- Grant checklist (Module 1.1.A §5.1, no exceptions): revoke
  `public` / `authenticated` / `anon`; grant `EXECUTE` to `service_role`
  only.

---

## 6. HTTP surface

### 6.1 Trial Balance *(decision #1)*

`GET /reports/trial-balance?company_id=&period_id=&include_zero_balance=`

Period must belong to `company_id` via `assertPeriodUsableForCompany`.

### 6.2 Balance Sheet *(decision #2)*

`GET /reports/balance-sheet?company_id=&as_of_date=`

`as_of_date` optional → Nest server today. Response includes
`is_balanced` summary.

### 6.3 Profit & Loss *(decision #3)*

`GET /reports/profit-and-loss?company_id=&period_start=&period_end=`

All three **required**. Nest rejects `period_end < period_start` with
**400** before calling the RPC.

Response shape: `{ period_start, period_end, accounts, total_income,
total_expense, net_profit }`.

### 6.4 General Ledger *(decision #5)*

`GET /reports/general-ledger?company_id=&account_id=&date_from=&date_to=`

`company_id` **required**; `account_id` / `date_from` / `date_to`
optional. When `account_id` is set, Nest runs
`assertAccountBelongsToCompany`. No pagination this pass.

Response: array of line rows including `running_balance`.

### 6.5 Auth

All report routes: `SupabaseAuthGuard` + `CompanyMembershipGuard` with
`@RequireCompanyMembership({ type: 'query' })`. Non-members → **403**.

---

## 7. Verification notes

Trial Balance *(#1 / #4)*:

- Reversal across two periods → Period 1 `closing_balance` keeps original;
  Period 2 nets pair to zero
- *(other #1 cases unchanged)*

Balance Sheet *(#2)* / P&L *(#3)* — as previously documented.

- Full fiscal-year activity → `net_profit` equals YE RE transfer for that
  year (run P&L **before** YE close on the same fixture)
- Empty partial-month range → zeros, not an error
- Income/expense balances follow `account_signed_balance` /
  `normal_balance` CASE (same as YE)
- Reversal landing **after** the P&L range does not remove in-range
  original activity; reversal **inside** the range nets out

General Ledger *(#5)*:

- Full dump: every ledger-truth line, ordered, running balances correct
- One-account filter: final `running_balance` equals `v_trial_balance.balance`
- Date-bounded: only in-range rows returned; first in-window
  `running_balance` includes pre-window activity (does **not** reset)
- Draft / pending_approval / rejected absent
- Cross-tenant `company_id` → **403**

Auth route count: **42** guarded routes (38 from 1.1.A + TB + BS + P&L + GL).

### 7.1 Cross-report integrity sweep *(decision #6)*

One shared fixture (extends TC11 YE + TC12 reverse patterns): fresh
company + COA → multi-period posts touching A/L/E/income/expense →
reverse one entry → year-end close → assert on the **same** final state:

| Check | Rule |
|---|---|
| TB ↔ BS | Dec-period TB `closing_balance` summed by A/L/E category equals BS totals as of `2026-12-31` |
| BS equation | `is_balanced` true after capital-only A/L/E checkpoint **and** after YE; mid-year open P&L may leave `is_balanced` false per decision #2 — imbalance must equal unclosed P&L `net_profit` |
| P&L ↔ YE | FY P&L `net_profit` (captured **before** YE) equals amount transferred to **3100** |
| §4.4 zeroing | Next-FY P&L `net_profit = 0`; post-YE same-FY P&L nets to 0 |
| GL ↔ BS (3100) | Sum of GL `line_balance` (= final `running_balance`) equals BS balance for 3100 |
| Reversal | Effect present on BS as-of before reversal date; net absent after across BS / GL / P&L |

**Sign-off:** sweep **passed clean** (2026-08-30) after fixing Module 1.1.A
`create_year_end_closing_entry` to use `is_ledger_truth_status` (#61) —
same closing posture as Module 1.1.A decision #59 for its integrity sweep.

---

## 8. Decision Log Index

Chronological, for traceability. Full rationale for each lives in the
topical section referenced.

| # | Date | Summary | Detail in |
|---|------|---------|-----------|
| 1 | 2026-08-29 | Period Trial Balance via `get_trial_balance_for_period` (SECURITY INVOKER, §5.1 grants); opening = posted before `period_start`, closing = opening + activity in `[period_start, period_end]`; Nest `GET /reports/trial-balance` with required `company_id`+`period_id` and `assertPeriodUsableForCompany` | §3, §5.2, §6.1 |
| 2 | 2026-08-29 | Balance Sheet via `get_balance_sheet` (SECURITY INVOKER, §5.1); as-of cumulative A/L/E only; lines from `posted`+`reversed` with `entry_date <= as_of`; Nest summary totals + `is_balanced`; `GET /reports/balance-sheet` with required `company_id`, optional `as_of_date` defaulting to server today | §4, §5.3, §6.2 |
| 3 | 2026-08-29 | Single-period P&L via `get_profit_and_loss` + shared `account_signed_balance` (lockstep with `create_year_end_closing_entry`); arbitrary date range; no prior-period comparison (H2); Nest `GET /reports/profit-and-loss` with required `company_id`/`period_start`/`period_end` and 400 on inverted range | §5, §5.4, §6.3, §7 |
| 4 | 2026-08-30 | **`is_ledger_truth_status`:** all H1 reporting reads treat `posted`+`reversed` as ground truth; `draft`/`pending_approval`/`rejected` never contribute; TB updated from posted-only to match BS/P&L; `v_trial_balance` later aligned in Module 1.1.A **#60** | §2, §3–§5, §7 |
| 5 | 2026-08-30 | **General Ledger** via `get_general_ledger` (line-level, SECURITY INVOKER, §5.1); running balance is true cumulative per account (date filters do **not** reset); pagination deferred (match §4.5/§4.6 list routes); Nest `GET /reports/general-ledger` with required `company_id`, optional filters, `assertAccountBelongsToCompany` | §5a, §5.5, §6.4, §7 |
| 6 | 2026-08-30 | **H1-5 cross-report integrity sweep PASSED clean** — multi-period + reverse + YE fixture; TB/BS/P&L/GL agree; surfaced Module 1.1.A YE posted-only bug → fixed as **#61** (`is_ledger_truth_status`); module sign-off (same role as 1.1.A #59); deferred items tracked in Known open items → H2/H remainder | §7.1, Known open items |
| 7 | 2026-09-19 | **Full Module H inventory.** H1 core (#1–#6) stays the rule set for TB/BS/P&L/GL. Aged AR/AP marked **completed** as D/E `/reports` reads (not new H1 RPCs). Product-list remainder catalogued as open H-R1…H-R16 (comparison, cash flow, sales mix, expense MoM, executive snapshot, two-period compare, TB free dates, PDF/XLSX/CSV, scheduled email, accountant share link, FS audit pack, GL pagination, BS presentation layout). No formulas invented. | Module H completed / open tables |
| 8 | 2026-09-20 | **Standing inventory after H2.** H1 #1–#7 bodies unchanged. H2 (`feature-spec-1.1.H2.md`, H2-1…H2-15) closed H-R1, H-R3, H-R5, H-R6, H-R9, H-R10, H-R11, H-R12, CSV of H-R13, and H-R16. Remaining: H-R2 UAE BS layout, H-R4 cash flow, H-R7/H-R8 product/salesperson, PDF/XLSX, H-R14 email, H-R15 share link. Guarded HTTP inventory **218**. | Module H completed / remaining tables |
| 9 | 2026-09-21 | **Merged H1 + H2 into this file.** Numbered H1 #1–#8 and H2-1…H2-15 bodies unchanged. Former `feature-spec-1.1.H1.md` / `feature-spec-1.1.H2.md` are pointers. | this document |
| 10 | 2026-09-21 | **Pointer files removed.** `feature-spec-1.1.H1.md` and `feature-spec-1.1.H2.md` deleted; this file is the only Module H spec. #9 bodies unchanged. | this document |

---

# Part II — Extended reports (H2-1…H2-15)

Former standalone spec `feature-spec-1.1.H2.md`, merged here 2026-09-21
(#9). Part I remains the rule set for period Trial Balance, as-of
Balance Sheet, single-period Profit & Loss, and unpaginated GL — do
not re-derive those from Part II.

**Implemented 2026-09-20.** H2-1…H2-8 are built (SQL + Nest + integrity
sweep). H2-9…H2-13 are schema-verification grounding. H2-14 is the
owner sales-account / CN-netting rule. H2-15 (2026-09-20) corrects
H2-14's amount basis from gross `line_total` to ex-VAT line net. No
H2-numbered decisions remain open.

**Grounding used for H2-9…H2-13:** `docs/source-of-truth/schema.sql`
(accounts, invoices, invoice_status, invoice_lines, credit_notes,
H1 report RPCs, G-37 `summarize_free_zone_income`),
`seed_finalized_coa_demo_company_0002.sql`, `feature-spec-1.1.C.md`,
`feature-spec-1_1_D.md` §5, `feature-spec-1_1_G.md` G-24/G-37,
`src/reports/reports.controller.ts`,
`src/common/controller-auth-coverage.spec.ts` (212 guarded routes at
ratification; live inventory is **218** after six H2 GETs).

## 9. Scope split — what H1's open table actually contained (former H2 §0)

Decision #7's "Module H — open (H remainder)" table listed
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
| H-R2 | BS UAE standard presentation layout | **No** — see §14 | — |
| H-R4 | Statement of Cash Flows | **No** — see §14 | — |
| H-R7 | Sales by product/service | **No** — see §14 | — |
| H-R8 | Sales by salesperson | **No** — see §14 | — |
| H-R14 | Scheduled email delivery | **No** — see §14 | — |
| H-R15 | Accountant share link | **No** — see §14 | — |

Eight items close this pass. Six stay open, plus the PDF/XLSX half of
H-R13 — each with a specific reason in §14, not a blanket "later."

---

## 10. Extended-report decisions (former H2 §1)

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

## 11. Schema surface (former H2 §2)

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

## 12. HTTP surface (former H2 §3)

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

## 13. Verification notes (former H2 §4; extends Part I §7)

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

## 14. Remaining H-R items (former H2 §5)

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

## 15. Decision log index — H2-1…H2-15 (former H2 §6)

| # | Summary | Detail in |
|---|---|---|
| H2-1 | P&L comparison, generalized mechanism closes H-R1 + H-R11 together | §10 H2-1 |
| H2-2 | Trial Balance for an arbitrary date range, additive alongside period-bounded TB | §10 H2-2 |
| H2-3 | GL pagination, additive params, running-balance correctness preserved across pages | §10 H2-3 |
| H2-4 | Expense analysis by COA sub-category, monthly buckets, re-reads P&L | §10 H2-4 |
| H2-5 | Sales by customer from invoice revenue, not AR ledger | §10 H2-5 |
| H2-6 | Executive summary as Nest-layer composition of existing reports, no new SQL | §10 H2-6 |
| H2-7 | CSV export closes this pass; PDF/XLSX deferred as a design decision | §10 H2-7 |
| H2-8 | Audit pack bundles H1 + H2-2 + H2-7, no new computation | §10 H2-8 |
| H2-9 | Grounding: comparison `SELECT * FROM get_profit_and_loss` | §10 H2-9 |
| H2-10 | Grounding: no TB report index; additive range route | §10 H2-10 |
| H2-11 | Grounding: offset pagination; drop/recreate GL signature | §10 H2-11 |
| H2-12 | Grounding: `accounts.sub_category` is a live column | §10 H2-12 |
| H2-13 | Grounding: `invoices.customer_id` + G-37 status; H2-13a closed by H2-14 | §10 H2-13 |
| H2-14 | Owner rule: sales = Sales Revenue ∪ FZ 4300/4310/4320; CNs net via `credit_notes.customer_id` | §10 H2-14 |
| H2-15 | Correction: sales amount is ex-VAT line net (`line_net_amount`), not gross `line_total` | §10 H2-15 |

---

## 16. Implemented — no open H2 residuals (former H2 §7)

H2-9…H2-13 are schema verification. H2-14 is the owner account-set
rule. H2-15 (2026-09-20) corrects H2-14's amount basis to ex-VAT line
net. No H2-numbered entries remain open.

H2-1…H2-8 are implemented. Guarded HTTP inventory is **218** routes
(`controller-auth-coverage.spec.ts`).

Deferred **out of this pass** (not open H2 questions): H-R2 BS UAE
layout, H-R4 cash flow, H-R7/H-R8 product/salesperson, PDF/XLSX
(half of H-R13), H-R14 scheduled email, H-R15 share link. See §14.
