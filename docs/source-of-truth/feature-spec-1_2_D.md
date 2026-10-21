# Module 1.2.D — Petty Cash Management
## Feature Specification — 🟡 DRAFT, not built, not a build authorization

Part of Module 1.2. Sequencing: `Module_1.2_Build_Order_Scope.md` #7 —
independent; depends on Module 1.1.A only. If built after B1, reuse B1's
reopen/variance patterns (Build Order §7). Grounded 2026-10-20 against
`docs/schema.sql`, the demo COA seed (`1000` Petty Cash: asset, Cash &
Bank, depth 1, active; no children; no cash over/short account), Rules PDF
§1.1/§1.3/§1.21/§1.24/§2.5, and `src/`.

**Q10 is open** (account per fund, VAT-on-voucher path into F, shortage/
overage posting, approval rules). This spec builds everything that does not
need those answers and leaves explicit, disabled hooks where it does.

---

## 1. System Context & Business Objective

**Functional purpose.** Rules §1.21: petty cash runs on the **imprest
system** — replenishment equals verified vouchers spent, with a physical
count reconciliation at each replenishment. SMEs need multiple funds
(departments/locations), receipted vouchers, and an auditable count trail.

**Technical goal.**

1. Funds whose balance **is a ledger balance** (one COA account per fund) —
   no separate counter (Build Order §7).
2. Vouchers with receipt attachments, maker-checker approval, ledger
   posting through the existing post path.
3. Counts that compute variance against the ledger.
4. Replenishments whose amount is derived, not typed: Σ posted vouchers
   since the last replenishment.

## 2. Technical Feature Deep-Dive & Code Requirements

### 2.1 Data Intake & Database Constraints

```sql
create type petty_cash_voucher_status as enum ('draft', 'submitted', 'approved', 'posted', 'rejected');

create table petty_cash_funds (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id),
  ledger_account_id  uuid not null references accounts(id),
  name               text not null,
  custodian_user_id  uuid not null,
  imprest_amount     numeric(18,2) not null check (imprest_amount > 0),
  funded_by_bank_account_id uuid references bank_accounts(id),  -- A1; null allowed if A1 not built
  establishment_entry_id uuid references journal_entries(id),
  is_active          boolean not null default true,
  closed_at          timestamptz,
  created_by         uuid not null,
  created_at         timestamptz not null default now(),
  unique (company_id, ledger_account_id),
  unique (company_id, name)
);

create table petty_cash_vouchers (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id),
  fund_id          uuid not null references petty_cash_funds(id),
  voucher_number   text,                       -- allocated at posting (D-6)
  voucher_date     date not null,
  payee            text not null,
  description      text not null,
  amount           numeric(18,2) not null check (amount > 0),   -- gross AED (D-4)
  expense_account_id uuid not null references accounts(id),
  receipt_file_url text,                       -- Supabase Storage path
  receipt_file_name text,
  status           petty_cash_voucher_status not null default 'draft',
  submitted_by     uuid, submitted_at timestamptz,
  approved_by      uuid, approved_at timestamptz,
  rejected_by      uuid, rejected_at timestamptz, rejection_reason text,
  journal_entry_id uuid references journal_entries(id),
  replenishment_id uuid,                       -- FK below
  created_by       uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (status <> 'rejected' or length(trim(rejection_reason)) > 0)
);
create unique index petty_cash_vouchers_number_uq
  on petty_cash_vouchers (company_id, voucher_number) where voucher_number is not null;

create table petty_cash_counts (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id),
  fund_id          uuid not null references petty_cash_funds(id),
  counted_at       timestamptz not null,
  as_of_date       date not null,
  denominations    jsonb not null default '{}'::jsonb,  -- {"1000": n, "500": n, ..., "coins": amount}
  counted_amount   numeric(18,2) not null check (counted_amount >= 0),
  book_balance     numeric(18,2) not null,              -- ledger, frozen at count
  variance         numeric(18,2) generated always as (counted_amount - book_balance) stored,
  counted_by       uuid not null,
  witnessed_by     uuid,
  variance_entry_id uuid references journal_entries(id),
  notes            text,
  created_at       timestamptz not null default now()
);

create table petty_cash_replenishments (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id),
  fund_id          uuid not null references petty_cash_funds(id),
  count_id         uuid not null references petty_cash_counts(id),   -- Rules §1.21: count at each replenishment
  amount           numeric(18,2) not null check (amount > 0),
  source_ledger_account_id uuid not null references accounts(id),
  journal_entry_id uuid references journal_entries(id),
  created_by       uuid not null,
  created_at       timestamptz not null default now(),
  unique (count_id)
);
alter table petty_cash_vouchers
  add constraint petty_cash_vouchers_replenishment_fk
  foreign key (replenishment_id) references petty_cash_replenishments(id);
```

**Guards (triggers, `security invoker`)**

- Fund `ledger_account_id`: same company, active, `category='asset'`,
  `sub_category='Cash & Bank'`; not `1010`, `1020`–`1070`, and not an A1
  `bank_accounts.ledger_account_id`. Whether that is `1000` itself, children
  of `1000` (depth 2, the `1021`/`1022` precedent, feature-spec.md #15), or
  new `char(4)` numbers is **Q10 — Open**; the guard checks category, never a
  number. One fund per account (unique).
- Voucher: editable only in `draft`; after `posted` the row is immutable
  except `replenishment_id` (set once). No DELETE grant on any D table.
- `expense_account_id` must be `category='expense'` and active; VAT
  accounts (`journal_hits_vat_accounts` list) refused (D-4).
- Count/replenishment rows insert-only.

Audit: `audit_log` insert on every status change (voucher), fund
create/close, count, replenishment.

`CompanyResourceKind` += `petty_cash_fund`, `petty_cash_voucher`,
`petty_cash_count`, `petty_cash_replenishment`.

**Entry type (D-5, Proposed, additive):** `petty_cash`. Rules §1.3 lists
cash payment as a native type; none exists today.

### 2.2 Processing Mechanics & Business Logic

**2.2.1 Establish fund.** `POST /petty-cash-funds` → row + establishment
JE: `Dr <fund account> / Cr <source bank ledger account>` for
`imprest_amount`, `entry_type='petty_cash'`, through `post()` (approval
threshold applies). The bank-side line later appears in B1 as a ledger
credit to match against the withdrawal.

**2.2.2 Voucher lifecycle (maker-checker, Rules §1.24)**

1. `draft` — created by the custodian (or any Staff+ member; Open D-7).
2. `submitted` — requires `receipt_file_url` (D-3, Proposed: a voucher
   without a receipt is not a "verified voucher" under Rules §1.21).
3. `approved` — Owner or Manager (pattern: `bills.service.ts` L180 /
   `journal-entries.service.ts` L436); **approver ≠ submitter** and
   **approver ≠ custodian** (D-8, Proposed; Rules §1.24 separation of
   duties). `rejected` requires a reason.
4. `posted` — RPC `post_petty_cash_voucher`: allocate `voucher_number`,
   draft JE `Dr <expense_account_id> / Cr <fund account>` for `amount`,
   `entry_type='petty_cash'`, `entry_date=voucher_date`,
   `reference_number=voucher_number`; then `post()`. Guard: fund ledger
   balance at `voucher_date` ≥ `amount` (cash cannot go negative). If
   `journal_approval_threshold` puts the JE in `pending_approval`, voucher
   stays `approved` until the JE posts (same two-gate behaviour as E-28).

Per-voucher posting (not expense-at-replenishment) follows Rules §1.1
accrual basis and keeps the fund's ledger balance equal to expected cash on
hand, which is what makes the count variance meaningful (D-2, Proposed).

**2.2.3 Count.** `POST /petty-cash-funds/:id/counts` with denominations
(AED notes 1000/500/200/100/50/20/10/5 + coins total). `counted_amount` =
Σ; `book_balance` = ledger-truth signed balance of the fund account at
`as_of_date` (reuse `account_signed_balance`); `variance` generated.
`witnessed_by` optional; required when `|variance| > 0`? **Open (D-9).**

**2.2.4 Variance posting — Q10 Open.** No cash over/short account exists in
the seed; none is invented. Options recorded: (a) expense/income account
chosen by Owner per count; (b) a new COA account per company; (c) suspense
`1910`/`2900` — conflicts with Rules §1.2 (suspense zero at close), so (c)
only with a close-blocking follow-up. Until decided, a non-zero variance is
recorded but **not posted**, and §2.2.5 blocks replenishment on that count.

**2.2.5 Replenish (imprest).** RPC `replenish_petty_cash_fund(fund, count,
source_ledger_account_id)`:

1. Count must be the latest for the fund, `variance = 0` (or its variance
   JE posted, once Q10 allows).
2. `amount` = Σ `posted` vouchers with `replenishment_id is null` — computed,
   never client-supplied (Rules §1.21 "replenishment equals verified
   vouchers spent").
3. Guard: `book_balance + amount = imprest_amount` exactly; else
   `PETTY_CASH_IMPREST_MISMATCH` (catches vouchers posted after the count or
   unposted variance).
4. JE `Dr <fund account> / Cr <source bank ledger account>`, `petty_cash`,
   `post()`; set `replenishment_id` on the vouchers.

Changing `imprest_amount` (raise/lower float) is a separate establishment-
style top-up/withdrawal JE; **Open (D-10)** whether that is in scope.

**2.2.6 Close fund.** Requires a final count with variance resolved; JE
`Dr <bank ledger account> / Cr <fund account>` for the remaining balance;
`is_active=false`, `closed_at`. Transfer between funds = close + establish
(D-11, Proposed — no third mechanism).

**2.2.7 Voucher number (D-6, Proposed).**
`allocate_next_petty_cash_voucher_number(company, date)` →
`PCV-YYYY-NNNN`, `pg_advisory_xact_lock(hashtext('pcv:'||company))`, max+1 —
copy of `allocate_next_invoice_number`. Allocated **at posting** only, so
rejected/draft vouchers consume no numbers. F-16 scopes the FTA gap
register to tax invoices; a PCV gap check is offered as a read-only report
(`GET /reports/petty-cash-voucher-register?year=` listing numeric gaps,
same algorithm as F-16) — internal control, not an FTA claim.

### 2.3 Controller Routing & Presentation Layer

| Verb | Path | Role |
|---|---|---|
| POST | `/petty-cash-funds` | Owner |
| GET | `/petty-cash-funds` | any member |
| GET | `/petty-cash-funds/:id` | any member — `{ledger_balance, imprest_amount, unreplenished_vouchers_total, last_count}` |
| POST | `/petty-cash-funds/:id/close` | Owner |
| POST | `/petty-cash-vouchers` | Owner, Accountant, Manager, Staff (D-7) |
| PATCH | `/petty-cash-vouchers/:id` | creator, `draft` only |
| POST | `/petty-cash-vouchers/:id/receipt` | creator — multipart, Storage upload |
| POST | `/petty-cash-vouchers/:id/submit` | creator |
| POST | `/petty-cash-vouchers/:id/approve` | Owner, Manager (≠ submitter, ≠ custodian) |
| POST | `/petty-cash-vouchers/:id/reject` | Owner, Manager — `{reason}` |
| POST | `/petty-cash-vouchers/:id/post` | Owner, Accountant |
| GET | `/petty-cash-vouchers` | any member — `?fund_id&status&from&to&limit&offset`, `?format=csv` |
| POST | `/petty-cash-funds/:id/counts` | custodian, Owner, Accountant |
| GET | `/petty-cash-funds/:id/counts` | any member |
| POST | `/petty-cash-funds/:id/replenishments` | Owner, Accountant — `{count_id, source_ledger_account_id}` |
| GET | `/reports/petty-cash-reconciliation/:fundId` | any member — `?as_of`, `?format=csv` |
| GET | `/reports/petty-cash-voucher-register` | any member — `?year` |

**Petty cash reconciliation report:** imprest amount; ledger balance;
unreplenished vouchers (itemised); last count (denominations, counted,
variance, counted/witnessed by); identity `ledger_balance + unreplenished =
imprest` shown with pass/fail. AED. JSON + CSV. Printable PDF and
Arabic/English voucher layout wait for the project-wide presentation layer
(C §9 / H PDF-XLSX deferred) — not built here.

## 3. UAE Regulatory Compliance Anchors

| Anchor | Source | Mechanism |
|---|---|---|
| Imprest: replenishment = verified vouchers; count at each replenishment | Rules §1.21 | §2.2.5 derived amount + required `count_id` + exact identity |
| Accrual basis | Rules §1.1 | Per-voucher posting (D-2) |
| Maker-checker; separation of duties | Rules §1.24 | D-8 + `journal_approval_threshold` via `post()` |
| No hard deletes; reversals only | Rules §1.3 | Posted voucher corrected by `reverse_journal_entry` + a new voucher; voucher row keeps `journal_entry_id` |
| Supporting documents kept 7 y (dual-relevant default) | Rules §2.5 | Receipt in Storage; no delete path; purge not built |
| Input VAT only with a valid tax invoice | F (input VAT from E bills); Build Order §7 | **D-4: vouchers post gross, no input VAT, until Q10 decides the VAT path.** VAT-bearing purchases with a tax invoice go through E bills |
| AED 55,000 cash threshold | — | **Open — not in Rules PDF, any module spec, or schema (owner 2026-10-20: log as open question). No hook built.** |

AED 10,000 invoice split: N/A to vouchers (it governs invoices *issued*,
C §6.2). Whether a simplified tax invoice receipt supports input-VAT
recovery on a voucher is part of Q10 — not asserted here. CT 375,000: G
reads the ledger; voucher expenses flow into its tracker with no hook.

## 4. Upstream/Downstream Event Pipelines

**Upstream.** User actions only. No cron.

**Downstream.**

| Event | Ledger | Other |
|---|---|---|
| Establish | Dr fund / Cr bank | bank-side line → B1 candidate |
| Voucher posted | Dr expense / Cr fund | G tracker (via ledger); voucher register |
| Replenish | Dr fund / Cr bank | bank-side line → B1 candidate |
| Close | Dr bank / Cr fund | — |
| Variance | none until Q10 | count row only |

No notifications (no mailer), no outbound webhooks.

## 5. Jest Testing & Verification Architecture

| Test | Asserts |
|---|---|
| `petty-cash.service.spec.ts` | approve by submitter ⇒ 403; approve by custodian ⇒ 403; Staff approve ⇒ 403; submit without receipt ⇒ 400; reject without reason ⇒ 400 |
| `petty-cash-imprest.spec.ts` (pure) | replenishment amount = Σ unreplenished posted; identity check; variance generated |
| `petty-cash.integration.spec.ts` | establish (fund = imprest); 3 vouchers posted ⇒ fund ledger = imprest − Σ; count matching ⇒ replenish ⇒ fund = imprest, vouchers linked; voucher over fund balance ⇒ error; posted voucher UPDATE ⇒ error; DELETE ⇒ error; `PCV-YYYY-0001..3` with no gaps; non-zero variance ⇒ replenish blocked |
| same | fund on `1020` or an A1 bank account ⇒ rejected; expense account `1400` ⇒ rejected |
| same | voucher above `journal_approval_threshold` ⇒ JE `pending_approval`, voucher not `posted` |
| isolation | other company's fund id ⇒ 404 |
| auth coverage | count updated |

---

# Decision log

| # | Decision | Status |
|---|---|---|
| D-1 | One COA account per fund; balance = ledger | Proposed (Build Order §7); which accounts **Q10 Open** |
| D-2 | Expense posted per voucher, not at replenishment | Proposed |
| D-3 | Receipt mandatory before submit | Proposed |
| D-4 | Vouchers gross, no input VAT, VAT accounts refused | Proposed interim; **Q10 Open** |
| D-5 | Additive `journal_entry_type` `petty_cash` | Proposed |
| D-6 | `PCV-YYYY-NNNN` at posting; read-only gap report | Proposed |
| D-7 | Who may create vouchers | Open |
| D-8 | Approver Owner/Manager, ≠ submitter, ≠ custodian | Proposed |
| D-9 | Witness required on non-zero variance | Open |
| D-10 | Changing the imprest float | Open |
| D-11 | Inter-fund transfer = close + establish | Proposed |
| Q10 | Fund accounts; VAT path; variance posting; approval | **Open** |
| — | AED 55,000 cash threshold | **Open — no source document** |
