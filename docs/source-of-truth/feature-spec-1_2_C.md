# Module 1.2.C — Historical Import (C1) & Migration Wizards (C2)
## Feature Specification — 🟡 DRAFT, not built, not a build authorization

Part of Module 1.2. Sequencing: `Module_1.2_Build_Order_Scope.md` #5 (C1)
and #6 (C2). Depends on A1 (`feature-spec-1_2_A.md`, staging + parser) and
B1 (`feature-spec-1_2_B.md`, matching + categorise) — neither is in
`schema.sql` yet. Grounded 2026-10-20 against `docs/schema.sql`
(`create_opening_balance_entry`, `allocate_next_entry_number`, period
guards), the demo COA seed (186-account template), Rules PDF §1.2/§1.3/§2.5,
and `src/`.

**Highest data-integrity risk in Module 1.2 (Build Order §5).** Five years
of history crosses closed periods, filed VAT returns (F), posted CT
provisions (G), and FTA invoice numbering (C). **Q6 is open and decides
whether any of that may be touched; this spec defaults every such path to
blocked.** Q1 (kept open, owner 2026-10-20) gates every posting path here
because C1 posting *is* B1's categorise at scale.

---

# Part I — C1: Bank History, AI Categorisation, Opening Balance Wizard

## 1. System Context & Business Objective

**Functional purpose.** A UAE SME moving onto inFINity needs (a) its
historical bank lines as supporting records (Rules §2.5: 7-year default),
(b) those lines categorised so history is usable, and (c) a correct opening
position to start reconciling and reporting from.

**Technical goal.**

1. Bulk CSV import (up to 5 years) into A1's `bank_statement_lines`
   (`source='historical_csv'`), same parser and dedupe key — no second
   pipeline.
2. Categorisation **suggestions** per line: deterministic learned rules
   first, model second (Q9), confidence below threshold → review queue.
   Suggestions never post by themselves.
3. A review queue with explicit "done" criteria.
4. An opening-balance wizard that orchestrates the existing
   `create_opening_balance_entry` RPC — no second opening mechanism.

## 2. Technical Feature Deep-Dive & Code Requirements

### 2.1 Data Intake & Database Constraints

Reused, unchanged: `bank_accounts`, `bank_statement_imports`,
`bank_statement_lines`, `bank_csv_mapping_profiles` (A1).

```sql
create table bank_categorisation_rules (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id),
  bank_account_id    uuid references bank_accounts(id),      -- null = all accounts
  match_tokens       text[] not null check (cardinality(match_tokens) > 0), -- normalised, all must appear
  direction          smallint not null check (direction in (-1, 1)),        -- sign of amount
  account_id         uuid not null references accounts(id),
  learned_from_line_id uuid references bank_statement_lines(id),
  confirmations      int not null default 1,
  is_active          boolean not null default true,
  created_by         uuid not null,
  created_at         timestamptz not null default now()
);

create table bank_line_categorisations (
  bank_line_id     uuid primary key references bank_statement_lines(id),
  company_id       uuid not null references companies(id),
  suggested_account_id uuid references accounts(id),
  suggestion_source text not null check (suggestion_source in ('rule', 'model', 'none')),
  rule_id          uuid references bank_categorisation_rules(id),
  confidence       numeric(5,4),
  provider         text, model_version text, prompt_version text,   -- model only (Q9 audit)
  review_status    text not null default 'needs_review'
    check (review_status in ('needs_review', 'accepted', 'rejected')),
  accepted_account_id uuid references accounts(id),
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now()
);
```

Counter-account restrictions are B1 §2.2.5's list (no AR/AP/advance
control accounts, no suspense, no VAT accounts, not `1070`) — enforced in
the same validator, not re-implemented.

`CompanyResourceKind` += `bank_categorisation_rule`.

### 2.2 Processing Mechanics & Business Logic

**2.2.1 Bulk import**

- Same two-phase preview/commit as A1 §2.2. The commit runs in a
  background job when the file exceeds a row cap (**Open C-1**): BullMQ if
  Q12 confirms Redis (copy `document-submission.queue.ts` gating, `attempts:
  3`, exponential backoff), else rejected with `413` above the cap and the
  user splits the file (`ponytail:` ceiling = sync commit size; upgrade =
  queue). Commit is chunked by RPC call (one transaction per chunk of N
  lines; Open C-1) with the import row tracking progress; dedupe makes a
  retried chunk idempotent.
- 5-year limit: `txn_date ≥ current_date − interval '5 years'` (feature
  list). Older rows are row-level errors, not silently dropped.

**2.2.2 Categorisation suggestions (no posting)**

1. Rules pass (deterministic): for each line, active rules whose
   `direction` matches the sign and whose `match_tokens ⊆ tokens(description
   + reference)`; most specific (most tokens, then account-scoped over
   company-wide, then most `confirmations`) wins; tie between different
   accounts ⇒ `suggestion_source='none'` (do not pick). Tokeniser = B1
   §2.2.2's `T(x)`, shared code.
2. Model pass (only lines still `none`, only when Q9 picks a provider):
   `CategorisationProvider` interface; sends description, reference, sign,
   amount, and the company's **active** COA (number + name) only; must
   return an account that exists in that list or nothing.
3. Confidence threshold for review: **Open (C-2/Q9)**. Until set, *every*
   model suggestion is `needs_review`; rule suggestions with `confirmations ≥
   N` may be bulk-accepted (N Open).
4. Learning: accepting a categorisation (accepted ≠ suggested, or
   suggestion `none`) creates or increments a rule — mirrors
   `feature-spec-1_1_B.md` B-5.2 (learn from human-approved, blank + forced
   choice for unclear). Rejections never create rules.

**2.2.3 From accepted categorisation to ledger — gated on Q1 + Q6**

Accepting a category records intent only. Posting uses **B1's categorise
path** (draft `bank_transaction` JE → `post()` → auto-match) and therefore:

- is disabled while Q1 is open (B1 §2.2.5);
- never posts into a period that is `soft_closed`/`closed` — the
  soft-close override reason in `post()` is **not** offered to bulk posting
  (C-3, Proposed);
- never posts on a date inside a `filed` VAT period or a fiscal year with a
  `posted`/`posted_nil` `ct_provision_entries` row (C-4, Proposed default
  for Q6 — blocked, not warned);
- runs as a **dry run first**: `POST …/history/preview-posting` returns
  per-period counts and P&L/BS deltas without writing; commit requires the
  preview id (C-5).

For a company that already records D/E payments in inFINity, history that
overlaps those dates must **match** (B1) rather than post — this is Q1 at
five-year scale; the dry run lists lines with exact-amount ledger
candidates separately so they are never bulk-posted.

**2.2.4 Review queue "done" criteria (C-6, Proposed)**

An import is *reviewed* when every line in it is one of: matched (B1),
excluded with reason (B1), categorised-and-posted, or `rejected` with
the line still `unreconciled` and visible in B1's queue. The import
endpoint exposes these four counts; there is no "mark done" flag to set.

**2.2.5 Opening balance wizard (orchestration only)**

Steps, each a stateless API call (no new wizard table):

1. `GET /opening-balance/readiness?fiscal_year=` → whether an
   `opening_balance` JE already exists (RPC raises
   `OPENING_BALANCE_ALREADY_EXISTS`), whether an **open** accounting period
   contains the chosen date, which A1 bank accounts lack opening positions.
2. `POST /opening-balance/preview` `{fiscal_year, entry_date, lines[]}` →
   validates: balance-sheet accounts only (category asset/liability/equity —
   the RPC's own rule), Σ debit = Σ credit **exactly** (there is no
   opening-balance-equity plug account in the COA seed; none is invented —
   C-7), active accounts, company scope.
3. Control accounts (Rules §1.2: control = Σ sub-ledger): non-zero opening
   on `1100` AR, `2000` AP, `2060`, `1350`, `1400`, `2200` is **rejected**
   until open-item import (opening invoices/bills) is scoped (C-8, Proposed;
   that is C2's deferred follow-up). Without open items, D/E aging and
   statements would not tie to the control account.
4. `POST /opening-balance` → calls `create_opening_balance_entry`
   unchanged. Role: Owner, Accountant. Approval threshold applies the same
   way it does today for that entry type (no new rule).
5. A1 per-account statement opening (`PUT /bank-accounts/:id/opening-
   position`) is offered as a separate step; the wizard shows ledger
   opening vs statement opening per bank account, and the difference is
   the opening outstanding items (A-5) — informational, not posted.

### 2.3 Controller Routing & Presentation Layer

| Verb | Path | Role |
|---|---|---|
| POST | `/bank-accounts/:id/history-imports` | Owner, Accountant — multipart, preview |
| POST | `/bank-accounts/:id/history-imports/:importId/commit` | Owner, Accountant — `202` + job id if queued |
| GET | `/bank-accounts/:id/history-imports/:importId` | any member — progress + four review counts |
| POST | `/bank-accounts/:id/history-imports/:importId/categorise` | Owner, Accountant — runs rules (+ model if enabled) |
| GET | `/bank-line-categorisations` | any member — `?import_id&review_status&source&min_confidence&limit&offset` |
| POST | `/bank-line-categorisations/:lineId/accept` | Owner, Accountant — `{account_id?}` |
| POST | `/bank-line-categorisations/:lineId/reject` | Owner, Accountant |
| POST | `/bank-line-categorisations/bulk-accept` | Owner, Accountant — rule-sourced only |
| POST | `/bank-accounts/:id/history/preview-posting` | Owner, Accountant — **disabled pending Q1/Q6** |
| POST | `/bank-accounts/:id/history/post` | Owner — **disabled pending Q1/Q6** |
| GET/POST | `/bank-categorisation-rules[/:id]` | Owner, Accountant (write) |
| GET | `/opening-balance/readiness` | any member |
| POST | `/opening-balance/preview` | Owner, Accountant |
| POST | `/opening-balance` | Owner, Accountant |

CSV export of the review queue via `ReportsCsvInterceptor`. No PDF.

## 3. UAE Regulatory Compliance Anchors

| Anchor | Source | Mechanism |
|---|---|---|
| Records 5 y VAT / 7 y CT, 7 y default | Rules §2.5 | History lines retained with `raw`; no delete |
| Period locking: no backdated postings into closed/filed periods except an explicit prior-period-adjustment workflow | Rules §1.3 | No such workflow exists; C-3/C-4 block instead (Q6 decides if one is built) |
| Control accounts reconcile to sub-ledgers | Rules §1.2 | C-8 |
| Every feed line matched or flagged; no silent suspense | Rules §1.21 | Suggestions never post; suspense refused |
| Filed VAT returns immutable | F (`assert_not_filed_vat_period`, F-38) | C-4 checks filed periods for **every** history posting, not only VAT-touching ones |
| CT provisions | G-13/G-22 | C-4 blocks years with a posted provision |

AED 10,000 invoice split: N/A (no invoices created). AED 55,000 cash
threshold: **Open — no source document.**

## 4. Upstream/Downstream Event Pipelines

Upstream: user upload; queue worker (if Q12). Downstream: staging rows;
suggestions; rules learned; (after Q1/Q6) `bank_transaction` JEs and B1
matches; opening balance JE via existing RPC → TB/BS. No notifications.

## 5. Jest Testing & Verification Architecture

| Test | Asserts |
|---|---|
| `categorisation-rules.spec.ts` (pure) | specificity ordering; tie ⇒ none; sign respected; learning increments |
| `categorisation-provider.spec.ts` | fake provider returning an account not in COA ⇒ discarded |
| `history-import.integration.spec.ts` | 5-year boundary row error; re-commit idempotent; chunk retry no duplicates |
| `opening-balance-wizard.integration.spec.ts` | unbalanced ⇒ 400; income account ⇒ 400; non-zero `1100` ⇒ 400 (C-8); second call ⇒ `OPENING_BALANCE_ALREADY_EXISTS`; success ⇒ BS balances |
| posting gate | history post returns pending-Q1/Q6 error |
| auth coverage | count updated |

---

# Part II — C2: Migration Wizards (QuickBooks/Xero, Tally/Zoho, Excel)

## 6. System Context & Business Objective

**Functional purpose.** Move a company's COA and history out of another
system without re-keying.

**Technical goal.** Three source adapters feeding **one** pipeline:
parse → map accounts → stage journals → validate → post. **First-pass
scope (Build Order §6 recommendation, Q6 open): COA mapping + opening
balances + journal-level history only.** Invoices, bills, contacts, and
open items are a separately scoped follow-up — they reach C/D/E numbering
(`INV-`/`BILL-`), VAT (F) and FTA rules.

## 7. Technical Feature Deep-Dive & Code Requirements

### 7.1 Data

```sql
create type migration_source as enum ('quickbooks', 'xero', 'tally', 'zoho_books', 'excel');
create type migration_status as enum ('uploaded', 'mapping', 'validated', 'posting', 'posted', 'failed', 'abandoned');

create table migration_jobs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  source        migration_source not null,
  source_format_version text not null,       -- pinned, see C-10
  status        migration_status not null default 'uploaded',
  file_url      text not null,
  file_sha256   char(64) not null,
  cutover_date  date,                        -- history before this date only
  summary       jsonb not null default '{}'::jsonb,
  created_by    uuid not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table migration_account_mappings (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id),
  source           migration_source not null,
  source_account_code text not null,
  source_account_name text not null,
  target_account_id uuid references accounts(id),
  action           text not null check (action in ('map', 'reject')),   -- 'create' is Open (C-9)
  decided_by       uuid not null,
  decided_at       timestamptz not null default now(),
  unique (company_id, source, source_account_code)
);

create table migration_staged_entries (
  id               uuid primary key default gen_random_uuid(),
  migration_job_id uuid not null references migration_jobs(id),
  company_id       uuid not null references companies(id),
  source_entry_ref text not null,
  entry_date       date not null,
  narration        text not null,
  lines            jsonb not null,           -- [{source_account_code, debit, credit, description}]
  validation_errors jsonb not null default '[]'::jsonb,
  journal_entry_id uuid references journal_entries(id),
  unique (migration_job_id, source_entry_ref)
);
```

Mappings are saved per company per source so a second file reuses them.

### 7.2 Processing

1. **Upload + parse** by adapter. Supported export formats/versions are
   **not specified here (C-10, Open)** — each adapter ships only with a
   pinned version and a real anonymised fixture. Excel: column-mapping step
   identical in shape to A1's CSV profile; strict row-level errors.
2. **Account mapping.** Every distinct source account must be `map`ped to
   an active target account of a compatible category, or `reject`ed
   (entries touching it then fail validation). Auto-suggest by exact
   number/name match against the finalised COA only; never auto-confirm.
   Unmapped behaviour (create vs reject vs suspense): **C-9 Open** —
   suspense is excluded by Rules §1.2 (suspense must be zero at close).
3. **Validate** each staged entry: balanced in AED; all accounts mapped;
   date < `cutover_date`; period exists and is `open`; not in a filed VAT
   period or a CT-provisioned year (C-4 rule); no line on AR/AP/VAT control
   accounts (C-8 reasoning — sub-ledgers would not tie); non-AED source
   amounts rejected (Q11).
4. **Post** (Owner; disabled pending Q6). Per entry: draft via
   `insert_journal_entry_draft`, `entry_type='historical_import'` (C-11,
   Proposed additive enum value), `reference_number = source_entry_ref`,
   then `post()` so balance trigger, period checks, and approval threshold
   apply. `entry_number` comes from `allocate_next_entry_number` — numbers
   will not follow historical date order; that is expected and is why
   `reference_number` keeps the source reference. Queue as C1 §2.2.1.
5. **Abandon** = status `abandoned`; staged rows stay (audit). Posted
   entries are corrected only by `reverse_journal_entry`.

### 7.3 Routes

| Verb | Path | Role |
|---|---|---|
| POST | `/migrations` | Owner — multipart + `source`, `source_format_version`, `cutover_date` |
| GET | `/migrations/:id` | any member |
| GET | `/migrations/:id/accounts` | any member — distinct source accounts + suggestion + current mapping |
| PUT | `/migrations/:id/accounts/:sourceCode` | Owner, Accountant — `{action, target_account_id?}` |
| POST | `/migrations/:id/validate` | Owner, Accountant |
| GET | `/migrations/:id/entries` | any member — `?has_errors&limit&offset`, `?format=csv` |
| POST | `/migrations/:id/post` | Owner — **disabled pending Q6** |
| POST | `/migrations/:id/abandon` | Owner |

## 8. Compliance Anchors

Rules §1.3 (no hard deletes; period locking), §1.2 (control accounts,
suspense), §2.5 (source files retained 7 y). FTA numbering untouched because
first-pass C2 creates no invoices/bills (Q6).

## 9. Pipelines

Upstream: upload; worker. Downstream: `historical_import` JEs → TB/BS/P&L/
GL, G's tracker for the fiscal years affected (which is why C-4 blocks
CT-provisioned years). No webhooks.

## 10. Jest

Adapter unit tests per pinned fixture; mapping persistence across jobs;
validation matrix (unbalanced, unmapped, control account, closed period,
filed VAT period, CT-provisioned year, non-AED); post gated; posted entry
`reference_number` = source ref; idempotent re-post skips entries with
`journal_entry_id`.

---

# Decision log

| # | Decision | Status |
|---|---|---|
| C-1 | Sync row cap / chunk size / queue use | Open (Q12) |
| C-2 | Model confidence threshold; bulk-accept N | Open (Q9) |
| C-3 | No soft-close override for bulk posting | Proposed |
| C-4 | Block history posting into filed VAT periods and CT-provisioned years | Proposed default for **Q6 (Open)** |
| C-5 | Dry-run preview required before history posting | Proposed |
| C-6 | Review "done" = four terminal states, derived | Proposed |
| C-7 | Opening balance must balance exactly; no plug account | Proposed (no such account in COA) |
| C-8 | No opening/migrated amounts on AR/AP/advance/VAT control accounts until open-item import is scoped | Proposed |
| C-9 | Unmapped source account: create vs reject | Open (suspense excluded) |
| C-10 | Pinned export formats per source | Open — no fixtures exist |
| C-11 | Additive `journal_entry_type` `historical_import` | Proposed |
| Q1 | Feed-first vs ledger-first | **Open — owner 2026-10-20** |
| Q6 | Closed/filed periods; scope of "history" | **Open** |
| — | AED 55,000 cash threshold | **Open — no source document** |
