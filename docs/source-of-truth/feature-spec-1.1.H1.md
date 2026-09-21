# Module 1.1.H — Financial Reports
## Feature Specification (Source of Truth)

Part of Module 1.1 · AI-Based Accounting Foundation, inFINity Phase 1 (MVP).

**H1 core (this document’s original scope, decisions #1–#6)** is the
authoritative rule set for period Trial Balance, as-of Balance Sheet,
single-period Profit & Loss, and General Ledger
(`Module_1.1_Build_Order_Scope.md` §1). Sections 1–7 below are those
H1 rules — do not invent cash-flow formulas, sales-mix logic, or
export layouts from them.

**Full Module H inventory (decision #7, 2026-09-19; standing updated
#8, 2026-09-20)** records what the product list asked for versus what
exists in this API today. Completed items cite the owning spec.
Remaining H-R items are listed below. H2 (`feature-spec-1.1.H2.md`)
closed a subset on 2026-09-20 — do not re-open those as H1 work.

There is **no UI** in this repository. “Completed” means HTTP + RPC
data. PDF/XLSX layout, email, and share links are not built. CSV on
the H1 four routes plus H2 report routes is built (H2-7).

**How to use this document:** Sections 1–7 state the current, effective
H1 rules. Section 8 is the chronological decision index. When a rule
changed after it was first logged, the section below states the
*current* rule only — the superseded version lives in Section 8.

Module 1.1.A (`feature-spec.md`, `schema.sql`) remains the engine
prerequisite. H1 adds reporting reads only — no new tables, no
transactional workflow changes. Aged AR/AP reads were added later by
D and E on `/reports/*`; they are not H1 decisions.

### Module H — completed

| Deliverable | Status | Evidence |
|---|---|---|
| Profit & Loss for any date range (month / quarter / year / custom) | **Completed** (H1 #3) | `get_profit_and_loss` · `GET /reports/profit-and-loss?period_start=&period_end=` |
| Balance Sheet at any date — assets, liabilities, equity (signed balances + `is_balanced`) | **Completed** (H1 #2) | `get_balance_sheet` · `GET /reports/balance-sheet?as_of_date=` |
| Trial Balance — all accounts with opening and closing debit/credit | **Completed** (H1 #1) | `get_trial_balance_for_period` · `GET /reports/trial-balance?period_id=` |
| General Ledger — transaction listing by account and date range (running balance; this is the drill-down surface) | **Completed** (H1 #5) | `get_general_ledger` · `GET /reports/general-ledger` |
| Aged Receivables with per-customer rows (drill via customer ledger / statement data) | **Completed** (D §5.1–§5.2) | `GET /reports/aged-receivables`, `/customer-ledger`, `/customer-statement` |
| Aged Payables with per-supplier rows (drill via supplier ledger / bills-due) | **Completed** (E §5.1–§5.2) | `GET /reports/aged-payables`, `/supplier-ledger`, `/bills-due` |
| Custom date range on P&L and GL; BS as-of any date | **Completed** (H1 #2 / #3 / #5) | Arbitrary `period_start`/`period_end`, `date_from`/`date_to`, `as_of_date` |
| Cross-report integrity (TB / BS / P&L / GL) | **Completed** (H1 #6) | `reports.h1-integrity-sweep.integration.spec.ts` |
| P&L comparison (prior or any two ranges) | **Completed** (H2-1) | `get_profit_and_loss_comparison` · `GET /reports/profit-and-loss-comparison` |
| Trial Balance for a caller date range | **Completed** (H2-2) | `get_trial_balance_for_range` · `GET /reports/trial-balance-range` (`GET /reports/trial-balance` stays `period_id`) |
| General Ledger pagination (`limit`/`offset`; running balance over the full set) | **Completed** (H2-3) | `get_general_ledger` 6-arg · `GET /reports/general-ledger` |
| Expense analysis by COA `sub_category`, month-over-month | **Completed** (H2-4) | `get_expense_analysis` · `GET /reports/expense-analysis` |
| Sales by customer (Sales Revenue ∪ FZ 4300/4310/4320; CN net; ex-VAT line net) | **Completed** (H2-5 / H2-14 / H2-15) | `get_sales_by_customer` · `GET /reports/sales-by-customer` |
| Executive summary (Nest composition of BS / P&L / aged AR / AP) | **Completed** (H2-6) | `GET /reports/executive-summary` |
| CSV export (`?format=csv`) on H1 four + H2 report routes | **Completed** (H2-7) | Nest interceptor — not D/E/F reports |
| Financial-statement audit pack (zip of TB/BS/P&L/GL CSVs for a `period_id`) | **Completed** (H2-8) | `GET /reports/audit-pack` |

### Module H — remaining (not in H2)

H2 (`feature-spec-1.1.H2.md`, H2-1…H2-15) closed H-R1, H-R3, H-R5,
H-R6, H-R9, H-R10, H-R11, H-R12, CSV of H-R13, and H-R16. Do not
implement the rows below from this table alone — they need their own
spec against the Accounting Rules PDF and `schema.sql`.

| # | Deliverable | Why remaining |
|---|---|---|
| H-R2 | Balance Sheet **UAE standard presentation layout** | H1 returns JSON by `category` (asset/liability/equity). No FTA/layout pack, no UI. Needs per-account current/non-current. |
| H-R4 | Statement of Cash Flows — **direct and indirect**, auto from ledger | Never designed. Needs cash categorization not in H1, H2, or A. |
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
summary / CSV / audit pack, shipped in H2 — they remain out of this
document's H1 rule set.

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
