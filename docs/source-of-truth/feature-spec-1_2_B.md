# Module 1.2.B — Bank Reconciliation Engine (B1 deterministic core, B2 AI matching)
## Feature Specification — 🟡 DRAFT, not built, not a build authorization

Part of Module 1.2. Sequencing: `Module_1.2_Build_Order_Scope.md` #2 (B1)
and #4 (B2). Depends on `feature-spec-1_2_A.md` (A1 staging table) — **not
in `schema.sql` yet**, so nothing here can be built before A1.
Grounded 2026-10-20 against `docs/schema.sql`, the demo COA seed, Rules PDF
§1.2/§1.3/§1.21/§1.22/§1.24, and `src/`.

**Naming:** everything here is `bank_reconciliation*` / `bank_line_*`.
Never `supplier_statement_*` or `reconcile_supplier_statement` (E) or
`reconcile_vat_return` (F) — Build Order §0.

**Open questions that gate sections of this spec:** Q1 (kept **open**,
owner 2026-10-20) gates §2.2.5 only; Q4 gates auto-confirm and residual
tolerance; Q5 gates lock-vs-period-close interaction; Q7 gates cheque
detail fields; Q8 gates the "FTA-ready" label; Q9 gates B2; Q11 gates non-AED
accounts. Everything else in B1 is buildable without those answers and is
designed so the answers slot in without schema churn.

---

# Part I — B1: Deterministic Reconciliation Core

## 1. System Context & Business Objective

**Functional purpose.** Rules §1.21: every bank feed transaction must be
matched or flagged unmatched, with no silent suspense posting; the
reconciliation report must tie book balance to statement balance with
itemised reconciling items (outstanding cheques, deposits in transit, bank
fees, unrecorded direct debits). Rules §1.22 makes "bank reconciliations
complete" the first step of the close checklist. Build Order §2: a
reconciliation closing to zero against D/E payments is the end-to-end proof
of the 1.1 ledger.

**Technical goal.**

1. Deterministic, explainable match suggestions between
   `bank_statement_lines` and **posted ledger lines on the bank account's COA
   account** — one rule that covers D payments, E supplier payments and runs,
   manual journals, opening balances, and anything else that hit the account.
2. Manual and split matching, with stored reasons.
3. Derived outstanding-cheque / deposit-in-transit registers.
4. A completable, lockable reconciliation per account per statement date,
   and its statement report.
5. The inherited D-12 `1070 → 1020` card/POS settlement entry.

## 2. Technical Feature Deep-Dive & Code Requirements

### 2.1 Data Intake & Database Constraints

**Match target = `journal_lines`, not `payments` (B-1, Proposed).** Every
cash movement already posted by D (`create_payment_journal_entry`) and E
(`create_supplier_payment_journal_entry`, `execute_supplier_payment_run`)
lands as a `journal_lines` row on the routed bank account
(`resolve_payment_debit_account_id`, D-12). Matching against those lines,
filtered by `is_ledger_truth_status`, covers every producer with one rule
and makes double-posting structurally visible: a bank line already matched
to a ledger line cannot be categorised again (§2.2.5).

Sign rule (follows A-3): bank line `amount > 0` ⇔ candidate ledger line is
a **debit** on the bank's ledger account; `amount < 0` ⇔ **credit**. Holds
for asset bank accounts and liability card accounts alike.

```sql
create type bank_reconciliation_status as enum ('in_progress', 'completed', 'reopened');
create type bank_match_method as enum ('rule_suggested', 'manual', 'ai_suggested', 'categorised');

create table bank_reconciliations (
  id                         uuid primary key default gen_random_uuid(),
  company_id                 uuid not null references companies(id),
  bank_account_id            uuid not null references bank_accounts(id),
  reconciliation_number      text,                       -- allocated at completion (B-9)
  statement_date             date not null,
  statement_closing_balance  numeric(18,2) not null,
  book_balance               numeric(18,2),              -- frozen at completion
  outstanding_payments_total numeric(18,2),              -- frozen at completion
  deposits_in_transit_total  numeric(18,2),              -- frozen at completion
  status                     bank_reconciliation_status not null default 'in_progress',
  previous_reconciliation_id uuid references bank_reconciliations(id),
  prepared_by                uuid not null,
  completed_by               uuid,
  completed_at               timestamptz,
  reopened_by                uuid,
  reopened_at                timestamptz,
  reopen_reason              text,
  created_at                 timestamptz not null default now(),
  unique (company_id, bank_account_id, statement_date),
  check (status <> 'reopened' or (reopened_by is not null and length(trim(reopen_reason)) > 0))
);
create unique index bank_reconciliations_one_open
  on bank_reconciliations (bank_account_id) where status in ('in_progress', 'reopened');

create table bank_line_matches (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id),
  bank_line_id         uuid not null references bank_statement_lines(id),
  journal_line_id      uuid not null references journal_lines(id),
  reconciliation_id    uuid references bank_reconciliations(id),
  matched_amount       numeric(18,2) not null check (matched_amount > 0),   -- absolute AED
  method               bank_match_method not null,
  score                numeric(5,4),          -- null for manual
  score_detail         jsonb,                 -- {amount_exact, date_delta_days, desc_similarity, tokens_hit[], rule_version}
  confirmed_by         uuid not null,
  confirmed_at         timestamptz not null default now(),
  voided_by            uuid,
  voided_at            timestamptz,
  void_reason          text,
  check ((voided_at is null) = (voided_by is null)),
  check (voided_at is null or length(trim(void_reason)) > 0)
);
create index idx_bank_line_matches_line on bank_line_matches (bank_line_id) where voided_at is null;
create index idx_bank_line_matches_jl on bank_line_matches (journal_line_id) where voided_at is null;

create table bank_line_exclusions (       -- "excluded" needs a reason, never silent
  bank_line_id   uuid primary key references bank_statement_lines(id),
  company_id     uuid not null references companies(id),
  reason         text not null check (length(trim(reason)) > 0),
  excluded_by    uuid not null,
  excluded_at    timestamptz not null default now()
);
```

**DB invariants (trigger `trg_bank_line_match_guard`, `security invoker`)**

- Bank line, journal line, reconciliation share `company_id`; the journal
  line's `account_id` = `bank_accounts.ledger_account_id` of the bank line;
  the journal entry is ledger-truth (`posted`/`reversed`).
- Sign rule above.
- Σ active `matched_amount` per bank line ≤ |`amount`|; Σ active
  `matched_amount` per journal line ≤ its `debit + credit`. (Split = many
  rows per bank line; many-to-one also allowed — a payment cleared in two
  bank lines.)
- When Σ per bank line = |`amount`| → `bank_statement_lines.recon_status =
  'matched'`; when it drops below (void) → `'unreconciled'`.
- Rows are never deleted or updated except to set `voided_*` once.
- No insert/void when the bank line's `txn_date ≤ statement_date` of a
  `completed` reconciliation on that account (lock, §2.2.6).

**Residual tolerance (Q4, Open).** Until decided, tolerance is **zero**: a
split must sum exactly. No auto-close of AED 0.01 differences.

**Reversed entries.** A ledger line whose entry is `reversed` stays a match
candidate (it did hit the bank in the ledger); its reversal's line is also a
candidate. Both normally net out as an outstanding pair; the user may match
neither (they net to 0 in the outstanding register) — no special case.

**Entry type for postings created here (B-4, Proposed, additive per F-24
precedent):** `alter type journal_entry_type add value 'bank_transaction';`
and `'bank_clearing_settlement'`. Rules §1.3 lists "cash receipt, cash
payment, bank transfer" as native entry types; neither value exists today.

**Audit.** `audit_log` insert on `bank_reconciliations` status changes and on
every `bank_line_matches` insert/void (inside the RPCs — the table is
append-only, so a trigger on insert/update is enough).

`CompanyResourceKind` += `bank_reconciliation`, `bank_line_match`.

### 2.2 Processing Mechanics & Business Logic

#### 2.2.1 Candidate generation (pure function + one SQL read)

`get_bank_match_candidates(p_company_id, p_bank_line_id)` (RPC,
`stable`, `security definer`, company check) returns ledger lines that:

1. are on the bank's ledger account, ledger-truth, with remaining
   unmatched amount > 0;
2. have the sign-compatible side;
3. have `|entry_date − txn_date| ≤ 3` days. **3 days is from the feature
   list (Build Order §2).** Calendar vs business days and per-company
   override are **Open (Q4)**; build as calendar days behind a single
   constant with a `ponytail:` note, so the Q4 answer is a one-line change.

Each candidate is joined to its source document when one exists
(`payments.journal_entry_id`, `supplier_payments.journal_entry_id`) to pick
up `reference_number`, customer/supplier name, and payment method for
scoring and for the UI.

#### 2.2.2 Scoring (Nest, pure, `bank-match-scoring.ts`)

```
amount_exact     = remaining_amount == |bank.amount|               (bool)
date_delta_days  = |entry_date − txn_date|                         (0..3)
desc_similarity  = |T(bank) ∩ T(ledger)| / |T(bank) ∪ T(ledger)|   (Jaccard, 0..1)
  T(x) = upper-cased alphanumeric tokens of length ≥ 3 from
         bank.description + bank.reference  vs
         journal narration + reference_number + counterparty name + source reference_number
```

`score` is a combination of the three. **Weights and the suggest threshold
are Open (Q4)** — they are not invented here. Until signed off: candidates
with `amount_exact` are listed ordered by (`date_delta_days` asc,
`desc_similarity` desc); non-exact amounts only appear in the split picker.
`score_detail` stores the three raw components + `rule_version`, so every
match can answer "why" (Build Order §2) and the weights can change later
without losing history.

**Auto-confirm: off.** Nothing is matched without a human confirm until Q4
sets an auto-confirm band. Rules §1.21 is satisfied either way because the
line is flagged unmatched until confirmed.

#### 2.2.3 Confirm / manual / split

`confirm_bank_line_match(p_company_id, p_bank_line_id, p_items jsonb,
p_method, p_actor)` — one RPC, one transaction:
`p_items = [{journal_line_id, matched_amount, score?, score_detail?}]`.
Validates every invariant in §2.1, inserts rows, flips `recon_status`,
writes audit. Split = >1 item. Manual = `method='manual'`, no score.

`void_bank_line_match(p_company_id, p_match_id, p_reason, p_actor)` — sets
`voided_*`; blocked under a completed reconciliation (§2.2.6).

Roles: Owner, Accountant confirm/void (B-6, Proposed — mirrors
`vat.service.ts` L67 gate for accountant-level work).

#### 2.2.4 Exclude

`exclude_bank_line(p_company_id, p_bank_line_id, p_reason, p_actor)` →
row in `bank_line_exclusions`, `recon_status='excluded'`. For lines that are
not company cash movements (e.g. a bank's informational zero-net pair, a
duplicate the dedupe key could not catch — A-4 ceiling). Owner, Accountant.

#### 2.2.5 Categorise unmatched line (feed-first half) — **gated on Q1**

What exists regardless of Q1: the posting mechanism.

1. Input: bank line, counter `account_id`, narration. AED only (Q11).
2. Build a **draft** journal entry, `entry_type='bank_transaction'`,
   `entry_date = txn_date`, two lines: bank ledger account (side by sign) and
   the counter account for |amount|. `reference_number` = bank line
   `reference` or `dedupe_key`.
3. Post through `JournalEntriesService.post()` — so
   `resolveApprovalThreshold` / `journal_approval_threshold` and period
   status checks apply unchanged (Build Order §0). The journal trigger
   `trg_assert_vat_period_on_journal_post` only blocks entries that hit VAT
   accounts (F-38, `journal_hits_vat_accounts`); B-7 entries never do, so the
   **period status is the effective backdating guard**. If approval is
   required, the entry sits in `pending_approval` and the bank line stays
   `unreconciled`.
4. On `posted`, auto-insert a `bank_line_matches` row
   (`method='categorised'`) linking the bank line to the new bank-side
   journal line.
5. Counter account restrictions: not `1100` AR, `2000` AP, `2060`, `1350`
   (control accounts must reconcile to sub-ledgers — Rules §1.2; customer and
   supplier cash goes through D/E so their sub-ledgers move). Not `1910`/
   `2900` suspense (Rules §1.21: no silent suspense posting). Not any
   account in `journal_hits_vat_accounts`' list (`1400`, `1410`, `1415`,
   `1420`, `2200`, `2210`, `2230`, `5580`, `5800`, `5641`) — VAT moves only
   through C/E/F (B-7). Not `1070` (settlement has its own path, §2.2.7).
6. **No VAT lines (B-7, Proposed).** A categorised bank line posts gross.
   Input VAT needs a tax invoice and flows through E bills → F; a VAT-bearing
   spend should be entered as an E bill and its payment matched. This keeps F's
   input-VAT sources unchanged.

What **Q1 decides** (left open, options recorded, nothing chosen):

| Option | Rule | Consequence |
|---|---|---|
| Ledger-first strict | Categorise blocked while any exact-amount candidate exists within the date window | Lowest double-count risk; slows users on coincidental amounts |
| Ledger-first with acknowledgement | Categorise allowed when candidates exist only with an explicit "not this payment" acknowledgement stored in the audit row | Same safety, auditable override |
| Feed-first | Categorise always allowed; D/E payments matched later | Highest double-count risk — conflicts with Build Order Q1 "never re-post" |

Until Q1 is signed off, the categorise endpoint ships **disabled**
(`503 BANK_CATEGORISE_PENDING_Q1`) or is not built; matching, exclusion,
registers, and completion do not need it.

#### 2.2.6 Reconciliation lifecycle and lock

1. **Start** `POST /bank-reconciliations` `{bank_account_id, statement_date,
   statement_closing_balance}`. Requires A1 opening position set
   (A-5). `statement_closing_balance` defaults from the latest committed
   import / Lean balance at that date if omitted. First reconciliation of an
   account starts from `bank_accounts.opening_balance`; later ones chain via
   `previous_reconciliation_id` and must have `statement_date >` previous.
2. **Work**: matching, exclusion, (categorise when Q1 allows). Matches made
   while a reconciliation is open get its `reconciliation_id`.
3. **Summary** (always computable, frozen at completion):
   - `book_balance` = signed balance of the ledger account at `statement_date`
     (`account_signed_balance`, ledger-truth only).
   - `deposits_in_transit` = Σ unmatched remaining of ledger **debits**
     dated ≤ statement date.
   - `outstanding_payments` = Σ unmatched remaining of ledger **credits**
     dated ≤ statement date.
   - `unrecorded_bank_items` = Σ `amount` of bank lines dated ≤ statement
     date with `recon_status='unreconciled'`.
   - `adjusted_bank = statement_closing_balance + deposits_in_transit −
     outstanding_payments`
   - `difference = adjusted_bank − book_balance − unrecorded_bank_items`
   (sign shown for an asset account; for a credit-card liability the RPC
   negates both balances so the same identity holds.)
4. **Complete** `complete_bank_reconciliation` RPC. Blocks unless
   `difference = 0.00` **and** `unrecorded_bank_items = 0` — every bank line
   on or before the statement date is matched or excluded with a reason
   (B-8, Proposed; Rules §1.21 "matched or flagged", no completion with
   unexplained items). Freezes the totals, allocates
   `reconciliation_number` (B-9), sets `completed_*`.
5. **Lock**: matches/voids/exclusions touching lines dated ≤ a completed
   `statement_date` are refused by the §2.1 trigger.
6. **Re-open** `POST /bank-reconciliations/:id/reopen` `{reason}` —
   **Owner only, reason mandatory, audit-logged** (Build Order §0: reuse the
   E-25 / G-22 Owner-override pattern). Only the **latest** completed
   reconciliation of an account may be reopened; to reach an older one, the
   later ones are reopened in order (B-10, Proposed — prevents a silent
   change under a later frozen statement).
7. **Interaction with `accounting_periods` close and filed VAT/CT (Q5,
   Open).** Options recorded: (a) independent lock; (b) period soft-close
   requires completed reconciliations for every active bank account up to
   period end (matches Rules §1.22 checklist order); (c) both. Hard-close is
   still a stub (`03-accounting-engine.mdc`), so (b) could only hook
   soft-close today. Not chosen here.

#### 2.2.7 D-12 inherited: `1070 → 1020` card/POS settlement

A processor payout arrives as a bank line (net of fees). The user selects
the open `1070` debit lines it settles (card/POS receipts, D-12 routing) and
the fee amount. RPC `create_bank_clearing_settlement`:

```
Dr  <bank ledger account>      net payout   (= bank line amount)
Dr  5700 Bank Charges & Fees   fee          (Proposed B-11 — needs sign-off)
Cr  1070 Merchant Clearing     gross        (Σ selected 1070 receipts)
```

`entry_type='bank_clearing_settlement'`, posted via `post()` (approval gate
applies), then the bank-side line is matched to the bank line
(`method='categorised'`). Guard: `net + fee = gross` exactly. Fee VAT: the
processor's VAT on fees is a supplier invoice — **not** posted here (B-7).
Which `1070` lines a payout covers is user-selected; no inference.

#### 2.2.8 Number allocation (B-9, Proposed)

`allocate_next_bank_reconciliation_number(company_id, statement_date)` →
`BREC-YYYY-NNNN`, `pg_advisory_xact_lock(hashtext('brec:'||company))`, max+1
— copy of `allocate_next_invoice_number`. Allocated **only at completion**,
so drafts never consume numbers. F-16 scopes FTA gap detection to tax
invoices only; a BREC gap register is not FTA-required and is **not built**
(the column is unique per company, and completion is the only allocator, so
gaps can only come from a failed transaction — same property as INV).

### 2.3 Controller Routing & Presentation Layer

| Verb | Path | Role |
|---|---|---|
| GET | `/bank-accounts/:id/lines/:lineId/candidates` | any member |
| POST | `/bank-line-matches` | Owner, Accountant — body `{bank_line_id, items[], method}` |
| POST | `/bank-line-matches/:id/void` | Owner, Accountant — `{reason}` |
| POST | `/bank-statement-lines/:id/exclude` | Owner, Accountant — `{reason}` |
| POST | `/bank-statement-lines/:id/categorise` | Owner, Accountant — **disabled pending Q1** |
| POST | `/bank-clearing-settlements` | Owner, Accountant |
| POST | `/bank-reconciliations` | Owner, Accountant |
| GET | `/bank-reconciliations` | any member — `?bank_account_id&status` |
| GET | `/bank-reconciliations/:id` | any member — three-column payload (below) |
| POST | `/bank-reconciliations/:id/complete` | Owner, Accountant |
| POST | `/bank-reconciliations/:id/reopen` | **Owner** — `{reason}` |
| GET | `/bank-reconciliations/:id/outstanding` | any member — `?type=payments|deposits`, `?format=csv` |
| GET | `/reports/bank-reconciliation/:id` | any member — `?format=csv` via `ReportsCsvInterceptor` |

**Three-column payload** (the "view" is an API shape; there is no UI in this
repo): `{summary, bank_unmatched[], ledger_unmatched[], matched[]}`, each
paginated (`limit`/`offset`), each ledger row carrying `source`
(`customer_payment` | `supplier_payment` | `journal`), counterparty, method,
reference. Drag-and-drop is a client concern; the server contract is
`POST /bank-line-matches`.

**Reconciliation statement report (B-12)** — Rules §1.21 minimum:
company legal name + TRN, bank account display name / IBAN, statement date,
statement closing balance, `+ deposits in transit` (itemised), `− outstanding
payments` (itemised, cheque method flagged), adjusted bank balance, book
balance, entries posted during this reconciliation (bank fees, direct debits
categorised — itemised), difference (must be 0.00 when completed),
`reconciliation_number`, prepared by / completed by + timestamps,
reopen history. Amounts AED. **Whether this layout is "FTA-ready" is Q8 —
not claimed until answered.** JSON + CSV now; PDF and Arabic labels wait
for the project-wide PDF/presentation work (H PDF-XLSX, C §9), not built
here.

**Outstanding cheques (Q7).** The outstanding-payments register is derived
(no new table). Rows whose source is a `supplier_payments` row with
`payment_method='cheque'` are labelled cheques; cheque number shows
`reference_number` (free text). Cheque date and post-dated flag **do not
exist** (§0.1) — added only when Q7 decides where they live.

## 3. UAE Regulatory Compliance Anchors

| Anchor | Source | Mechanism |
|---|---|---|
| Every feed line matched or flagged; no silent suspense posting | Rules §1.21 | `recon_status`; completion blocked on unreconciled; suspense refused as counter account |
| Report ties book to bank with itemised items | Rules §1.21 | §2.2.6 identity + B-12 report |
| Bank recs first in close checklist | Rules §1.22 | Q5 option (b) |
| Suspense/clearing zero at period-end | Rules §1.2 | `1070` settlement (§2.2.7) drains clearing; enforcement at close is not built here |
| No hard deletes; corrections by reversal | Rules §1.3 | Matches voided, never deleted; categorised postings corrected via `reverse_journal_entry` (then the auto-match is voided with reason) |
| Backdated postings blocked in closed/filed periods | Rules §1.3, F-38 | Categorise/settlement go through `post()` (period status); filed-VAT guard is moot because these entries carry no VAT lines (B-7) |
| Maker-checker above threshold; approval for payments above threshold | Rules §1.24 | `journal_approval_threshold` via `resolveApprovalThreshold` |
| Records 7-year default | Rules §2.5 | Reconciliations and matches are never deleted |

Not applicable: AED 10,000 invoice split (C §6.2); CT 375,000 (G reads
the ledger — categorised P&L postings flow into G's tracker automatically,
no hook needed); AED 55,000 cash threshold — **not in any source; Open
(owner 2026-10-20: log as open question).**

## 4. Upstream/Downstream Event Pipelines

**Upstream.** A1/A2/C1 inserting `bank_statement_lines`; D/E posting
payments (new ledger candidates); manual journals on bank accounts; user
actions on the routes above. No cron in B1.

**Downstream.**

| Event | Effect |
|---|---|
| Categorise posted | 1 JE `bank_transaction` (2 lines) → TB/BS/P&L/GL; G tracker reads it; audit row |
| Settlement posted | 1 JE `bank_clearing_settlement` (3 lines) |
| Match confirm/void | `bank_statement_lines.recon_status` flip; audit |
| Complete / reopen | Frozen totals; number allocated; audit; (Q5) period-close signal |

No notification (no mailer — H-R14), no outbound webhook.

## 5. Jest Testing & Verification Architecture

| Test | Asserts |
|---|---|
| `bank-match-scoring.spec.ts` (pure) | Jaccard tokens; date delta; ordering; `score_detail` shape; window constant |
| `bank-reconciliation-summary.spec.ts` (pure) | identity for asset and card accounts; difference math on fixtures |
| `bank-reconciliation.integration.spec.ts` | **End-to-end proof (Build Order §2):** issue invoice → D payment (`bank_transfer`) → E bill → E supplier payment → import CSV with both lines + a bank fee line → confirm 2 matches → exclude/handle fee → complete → `difference = 0.00`; `BREC-YYYY-0001` allocated |
| same | split match: one bank line ↔ two D payments; sum mismatch rejected |
| same | over-match of a journal line rejected by trigger |
| same | match under completed reconciliation → error; Owner reopen with empty reason → 400; Accountant reopen → 403; Owner reopen → audit row |
| same | categorise endpoint returns pending-Q1 error (until Q1 decided) |
| `bank-clearing-settlement.integration.spec.ts` | card payment → `1070`; payout line → settlement JE balanced, `1070` drained, bank line matched; `net + fee ≠ gross` rejected; above `journal_approval_threshold` → `pending_approval`, bank line still unreconciled |
| membership isolation | another company's `journal_line_id` → 404 |
| `controller-auth-coverage.spec.ts` | route count updated |

No mocks of Postgres for invariants — triggers are proved against the live
test DB, as the 1.1 integration suites do.

---

# Part II — B2: AI Matching Layer

## 6. System Context & Business Objective

**Functional purpose.** Find likely matches where bank descriptions and
ledger narrations differ (e.g. truncated payee names) and allow bulk
confirmation.

**Technical goal.** A suggestion producer that writes candidate rows a
human confirms through **B1's** `confirm_bank_line_match`
(`method='ai_suggested'`). B2 never matches, posts, or bypasses B1
invariants (Build Order §4).

## 7. Technical Feature Deep-Dive & Code Requirements

### 7.1 Data

```sql
create table bank_match_suggestions (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id),
  bank_line_id      uuid not null references bank_statement_lines(id),
  items             jsonb not null,           -- [{journal_line_id, matched_amount}]
  confidence        numeric(5,4) not null check (confidence between 0 and 1),
  provider          text not null,
  model_version     text not null,
  prompt_version    text not null,
  input_digest      jsonb not null,           -- exactly which fields were sent out (Q9 audit)
  status            text not null default 'pending' check (status in ('pending','confirmed','dismissed','stale')),
  decided_by        uuid,
  decided_at        timestamptz,
  match_id          uuid references bank_line_matches(id),
  created_at        timestamptz not null default now()
);
```

### 7.2 Processing

1. Input set: bank lines still `unreconciled` after B1 candidates, plus
   ledger lines within the B1 window **and amount-compatible** (B2 widens
   description matching only, not amount/date — B-13, Proposed).
2. Provider: **Open (Q9)** — no AI SDK exists in the repo. Build a
   `MatchSuggestionProvider` interface; one adapter once Q9 picks a provider.
   Payload minimisation: send description, reference, amount, date,
   counterparty name only — never IBAN, account numbers, TRN (B-14,
   Proposed; Q9 must confirm what may leave the environment).
3. Execution: batch per bank account. BullMQ if Q12 confirms Redis (reuse
   `document-submission.queue.ts` gating); otherwise synchronous on request
   with a per-request line cap (Open).
4. A suggestion becomes `stale` if its bank line or any journal line is
   matched by another path before decision.
5. **Bulk confirm** `POST /bank-match-suggestions/bulk-confirm`
   `{ids[]}` or `{bank_account_id, min_confidence}` → loops B1's confirm RPC
   per suggestion; each succeeds or fails independently; response lists both.
   Guardrails (Q4/Q9 — thresholds Open): split suggestions and suggestions
   above `journal_approval_threshold` amount are **excluded from bulk** and
   need single confirm (B-15, Proposed).
6. Accuracy bar before enablement: labelled set of bank/ledger pairs;
   precision target **Open** — not "looks good in demo" (Build Order §4).

### 7.3 Routes

| Verb | Path | Role |
|---|---|---|
| POST | `/bank-accounts/:id/match-suggestions/run` | Owner, Accountant |
| GET | `/bank-match-suggestions` | any member — `?bank_account_id&status&min_confidence` |
| POST | `/bank-match-suggestions/:id/confirm` | Owner, Accountant |
| POST | `/bank-match-suggestions/:id/dismiss` | Owner, Accountant |
| POST | `/bank-match-suggestions/bulk-confirm` | Owner, Accountant |

## 8. Compliance Anchors

Rules §1.21 (no silent matching: human confirm), Rules §1.24 (audit: who
confirmed, model/version, inputs), Rules §2.5 (suggestions retained). Data
residency / external processing of bank text: **Open (Q9)**.

## 9. Pipelines

Upstream: manual run; optionally after A1/A2 commit (Open — would need
queue). Downstream: on confirm → B1 match + audit; nothing else.

## 10. Jest

Fake provider returning fixed suggestions: stale detection; bulk confirm
partial failure; split/over-threshold excluded from bulk; confirm goes
through B1 invariants (over-match still rejected); `input_digest` never
contains IBAN/TRN.

---

# Decision log

| # | Decision | Status |
|---|---|---|
| B-1 | Match target is `journal_lines` on the bank's ledger account (ledger-truth), not `payments` rows | Proposed |
| B-2 | Sign rule: `amount > 0` ⇔ ledger debit | Proposed (follows A-3) |
| B-3 | Residual tolerance zero until Q4 | Proposed |
| B-4 | Additive `journal_entry_type` values `bank_transaction`, `bank_clearing_settlement` | Proposed |
| B-5 | 3-day window calendar days behind one constant | Window from feature list; calendar/business + override **Open (Q4)** |
| B-6 | Owner/Accountant match & complete; Owner-only reopen | Reopen Owner-only is Build Order §0; rest Proposed |
| B-7 | Categorised lines post gross, no VAT; VAT-bearing spend goes through E bills | Proposed |
| B-8 | Completion requires difference 0.00 and no unreconciled line ≤ statement date | Proposed |
| B-9 | `BREC-YYYY-NNNN` at completion; no gap register (F-16 scope) | Proposed |
| B-10 | Reopen latest completed reconciliation only | Proposed |
| B-11 | Merchant fees on settlement → `5700` | **Proposed — account choice needs sign-off** |
| B-12 | Report field list per Rules §1.21 | Proposed; "FTA-ready" **Open (Q8)** |
| B-13 | B2 widens description only, not amount/date | Proposed |
| B-14 | B2 payload minimisation | Proposed; **Q9 Open** |
| B-15 | Bulk-confirm exclusions (split, over approval threshold) | Proposed; bands **Open (Q4)** |
| Q1 | Feed-first vs ledger-first | **Open — owner 2026-10-20; categorise ships disabled** |
| Q5 | Lock vs period close | Open — options (a)/(b)/(c) |
| Q7 | Cheque number/date/post-dated fields | Open |
| — | AED 55,000 cash threshold | **Open — no source document** |
