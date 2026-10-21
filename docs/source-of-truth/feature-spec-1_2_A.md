# Module 1.2.A — Bank Accounts, Statement Import & Lean Open Banking
## Feature Specification — 🟡 DRAFT, not built, not a build authorization

Part of Module 1.2 · Bank Accounts & Reconciliation, inFINity Phase 1.
Sequencing: `Module_1.2_Build_Order_Scope.md` #1 (A1) and #3 (A2).
Grounded 2026-10-20 against `docs/schema.sql`, `docs/seed_finalized_coa_demo_company_0002.sql`,
`Accounting Rules - inFINity.pdf` (extracted text), and `src/` as it stands.

**Status convention (same as `feature-spec-1_1_B.md`):** every row in the
decision log marked *Proposed* or *Open* needs owner sign-off before the
section that depends on it is built. Anything not evidenced in a repo file
is labelled **Assumption**.

**Blocking open questions carried from the Build Order:** Q1 (feed-first vs
ledger-first — kept **open** by owner instruction 2026-10-20), Q2 (bank ↔ COA
mapping, credit-card liability account), Q3 (Lean coverage/data residency),
Q11 (currency), Q12 (queue infra). A1 §2.1 is designed so the staging table
does not presuppose a Q1 answer.

---

# Part I — A1: Bank Accounts & Manual Statement Import (CSV / OFX)

## 1. System Context & Business Objective

**Functional purpose.** UAE SMEs must keep bank statements as supporting
records (Rules §2.5: 5 years VAT, 7 years CT; **7-year default** for
dual-relevant records) and must reconcile book cash to the bank (Rules
§1.21; Rules §1.22 close checklist starts with "bank reconciliations
complete"). Today inFINity has no bank-account register and nowhere for a
bank line to land (Build Order §0.1; `feature-spec-1_1_B.md` §0.4/§6).

**Technical goal.**

1. A `bank_accounts` register, one row per real bank/credit-card account,
   each bound to exactly one COA account (the ledger stays the balance of
   record — no shadow counter).
2. A single, append-only **bank-line staging table** that every producer
   writes into (CSV, OFX, Lean A2, historical C1, OCR B2), with a dedupe key
   so overlapping imports never duplicate lines.
3. Book balance vs last-statement balance, side by side, per account.
4. A per-account opening position that reconciliation (B1) can start from.

A1 **never posts to the ledger.** It writes register, staging, and import
metadata only. Posting from a bank line is B1's job and is gated on Q1.

## 2. Technical Feature Deep-Dive & Code Requirements

### 2.1 Data Intake & Database Constraints

All DDL goes through `.cursor/workflows/database-change.md`; additive only;
`docs/schema.sql` plus an `apply_*.sql` for live DBs. Money `numeric(18,2)`.
RLS `company_isolation_<table>` on `current_setting('app.current_company_id')`
for every new table (same text as `bill_extraction_meta`).

**New enums**

```sql
create type bank_account_kind as enum ('current', 'savings', 'credit_card', 'deposit', 'other');
create type bank_line_source  as enum ('csv', 'ofx', 'lean', 'historical_csv', 'ocr_pdf');
create type bank_import_status as enum ('parsed', 'committed', 'failed');
```

`ocr_pdf` is reserved for 1.1.B B2 once this table exists; B2 still may not
post or match (`feature-spec-1_1_B.md` B-0.4a).

**`bank_accounts`**

```sql
create table bank_accounts (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id),
  ledger_account_id    uuid not null references accounts(id),   -- Q2: one COA account per bank account
  kind                 bank_account_kind not null,
  display_name         text not null,
  bank_name            text,
  iban                 text,                                   -- validated at API layer only (format, not checksum: Assumption, see A-6)
  account_number_last4 char(4),                                -- never store full PAN for credit_card (A-7)
  currency             char(3) not null default 'AED',         -- Q11
  opening_balance      numeric(18,2),                          -- statement-side opening position (A-5)
  opening_balance_date date,
  is_active            boolean not null default true,
  created_by           uuid not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (company_id, ledger_account_id),
  check ((opening_balance is null) = (opening_balance_date is null))
);
```

DB guards (trigger `trg_validate_bank_account`, `security invoker`):

- `ledger_account_id` must belong to `company_id` and be `is_active`.
- `kind <> 'credit_card'` ⇒ account `category = 'asset'` and
  `sub_category = 'Cash & Bank'` (seed: 1000–1070 carry that sub-category).
- `kind = 'credit_card'` ⇒ account `category = 'liability'`. **There is no
  credit-card liability account in the seed** (§0.1); until Q2 names one, a
  company cannot register a credit card. The trigger enforces category, not a
  number — no account number is invented here.
- `1000` Petty Cash and `1010` Cash on Hand are rejected (they are not bank
  accounts; petty cash is Module 1.2.D).
- `1070` Merchant / Payment Gateway Clearing is rejected as a bank account —
  it is a clearing account whose `1070 → 1020` settlement is B1 scope (D-12).
- No hard delete: deactivate only (`is_active = false`), and only when no
  `bank_statement_lines` row is `unreconciled` (A-8). No `DELETE` grant.

**`bank_statement_imports`** (one row per file/pull — the trace for every line)

```sql
create table bank_statement_imports (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references companies(id),
  bank_account_id        uuid not null references bank_accounts(id),
  source                 bank_line_source not null,
  status                 bank_import_status not null default 'parsed',
  file_name              text,
  file_url               text,          -- Supabase Storage path (journal_attachments.file_url pattern)
  file_sha256            char(64),
  mapping_profile_id     uuid,          -- FK below; CSV only
  statement_from         date,
  statement_to           date,
  statement_opening_balance numeric(18,2),
  statement_closing_balance numeric(18,2),
  lines_parsed           int not null default 0,
  lines_inserted         int not null default 0,
  lines_duplicate        int not null default 0,
  error_detail           jsonb,
  created_by             uuid not null,
  created_at             timestamptz not null default now(),
  committed_at           timestamptz
);
create unique index bank_statement_imports_file_uq
  on bank_statement_imports (company_id, bank_account_id, file_sha256)
  where file_sha256 is not null and status = 'committed';
```

**`bank_statement_lines`** — the staging table (load-bearing; Build Order §1)

```sql
create table bank_statement_lines (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id),
  bank_account_id     uuid not null references bank_accounts(id),
  import_id           uuid not null references bank_statement_imports(id),
  source              bank_line_source not null,
  dedupe_key          text not null,
  external_id         text,                 -- OFX FITID / Lean transaction id
  txn_date            date not null,
  value_date          date,
  description         text not null,
  reference           text,
  amount              numeric(18,2) not null check (amount <> 0), -- signed, company perspective (A-3)
  currency            char(3) not null,     -- as on statement (Rules §1.3)
  running_balance     numeric(18,2),
  raw                 jsonb not null default '{}'::jsonb,         -- original row/record, never rewritten
  recon_status        text not null default 'unreconciled'
    check (recon_status in ('unreconciled', 'matched', 'excluded')),
  created_at          timestamptz not null default now(),
  unique (company_id, bank_account_id, dedupe_key)
);
create index idx_bank_lines_account_date on bank_statement_lines (bank_account_id, txn_date);
create index idx_bank_lines_unreconciled on bank_statement_lines (bank_account_id) where recon_status = 'unreconciled';
```

Immutability (trigger `trg_bank_line_immutable`): after insert, only
`recon_status` may change, and only via B1's RPCs. `txn_date`, `amount`,
`description`, `raw`, `dedupe_key` are frozen. No `DELETE` — a wrong import
is neutralised by setting its lines `excluded` with an audit row (A-9),
mirroring Rules §1.3 "no hard deletes". `recon_status` ownership moves to B1
(`feature-spec-1_2_B.md`); A1 only ever writes `unreconciled`.

**Dedupe key (A-4)**

| Source | `dedupe_key` |
|---|---|
| OFX | `ofx:` + `FITID` (OFX spec makes FITID unique per account) |
| Lean | `lean:` + Lean transaction id (A2) |
| CSV / historical CSV | `csv:` + sha256(`txn_date` · `amount` · normalised description · `running_balance` or '' · occurrence index of that tuple within the file) |

Normalised description = trim, collapse whitespace, upper-case. The
occurrence index lets two genuinely identical same-day lines in one file
both land. **Known ceiling** (`ponytail:` comment required in the parser):
if an overlapping second file contains *fewer* copies of an identical tuple
than the first, the extra copy cannot be told apart; with `running_balance`
present the collision disappears. Insert uses
`on conflict (company_id, bank_account_id, dedupe_key) do nothing` and
counts conflicts into `lines_duplicate`.

**`bank_csv_mapping_profiles`** (per bank, per company)

```sql
create table bank_csv_mapping_profiles (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  name          text not null,
  bank_name     text,
  mapping       jsonb not null,  -- {date_col, date_format, description_col, amount_col | debit_col+credit_col, balance_col?, reference_col?, header_rows, decimal_sep}
  created_by    uuid not null,
  created_at    timestamptz not null default now(),
  unique (company_id, name)
);
```

`date_format` is explicit (`DD/MM/YYYY` vs `MM/DD/YYYY` cannot be inferred
safely). No per-bank profile is shipped as "supported" until a real
anonymised statement from that bank passes (same rule as
`feature-spec-1_1_B.md` §7).

**Audit.** Attach an `audit_log` insert trigger (pattern:
`log_journal_entry_change`) to `bank_accounts` and `bank_statement_imports`;
status changes on `bank_statement_lines` are logged by B1's RPCs.

**`CompanyResourceKind`** gains `bank_account`, `bank_statement_import`,
`bank_csv_mapping_profile`, `bank_statement_line`.

### 2.2 Processing Mechanics & Business Logic

**Import (CSV/OFX) — two-phase, preview then commit**

1. `POST …/imports` (multipart). Guard: membership; role Owner or
   Accountant (pattern: `public-holidays.service.ts` L29). Size cap: **Open
   (A-10)** — not invented here.
2. Store file in Supabase Storage; compute `file_sha256`. If a `committed`
   import with the same hash exists for this account → `409
   BANK_IMPORT_DUPLICATE_FILE`.
3. Parse:
   - OFX: SGML (1.x) and XML (2.x). `STMTTRN` → line; `LEDGERBAL` →
     closing balance; `DTSTART`/`DTEND` → range. Reject if `BANKACCTFROM`/
     `CCACCTFROM` currency ≠ `bank_accounts.currency`.
   - CSV: apply the mapping profile. Every row either parses fully or is
     reported as a row-level error `{row, column, reason}`; **no partial
     guess** of a date or amount.
4. Sign normalisation to company perspective (A-3) — `amount > 0` means
   money in (debit to the bank asset / reduction of card liability):
   - OFX: `TRNAMT` is already account-holder perspective; for
     `CCACCTFROM` the same sign rule holds (charge = negative).
   - CSV: single signed column taken as-is unless profile sets
     `invert_sign`; debit/credit columns → `credit − debit` for bank
     accounts. For credit cards the profile must state which column is
     "charge" (no default — A-3).
5. Insert `bank_statement_imports(status='parsed')` + response with preview
   (counts, first N rows, row errors, would-be duplicates). Lines are not yet
   inserted.
6. `POST …/imports/:id/commit` → single RPC `commit_bank_statement_import`
   (`security definer`, `set search_path = public, pg_temp`, company check
   inside, `revoke all from public`): inserts lines with
   `on conflict do nothing`, sets counters, `status='committed'`. One
   transaction — either the whole file lands or none of it (the repo has no
   Nest-level Postgres transactions, so atomicity lives in the RPC;
   `02-architecture.mdc`).
7. Running-balance check (if the file carries balances): for consecutive
   lines, `prev.running_balance + amount = running_balance`; mismatch is a
   warning on the import, not a block (banks reorder same-day lines). The
   statement closing balance is stored on the import.

**Book vs bank balance** (`GET /bank-accounts/:id/balances`)

- Book = `account_signed_balance` over `journal_lines` on
  `ledger_account_id` where `is_ledger_truth_status(status)`, as of `as_of`.
  Reuse H's helpers; no new balance SQL.
- Bank = `statement_closing_balance` of the latest committed import whose
  `statement_to <= as_of` (A1); live balance from Lean replaces it in A2.
- Response always says which import/feed the bank figure came from and its
  date, so a stale statement is visible, not presented as current.

**Opening position (A-5).** `opening_balance` / `opening_balance_date` on
`bank_accounts` record the **statement** balance at the date reconciliation
starts. It is not a journal. The ledger opening stays the once-per-fiscal-
year `create_opening_balance_entry` (feature-spec.md; Build Order §5). B1
refuses to start a reconciliation for an account with null opening fields.

**`default_bank_account_id` (Q2/D-13).** A1 does **not** write it. Still
seed/SQL only, as D-13/E-26/F-10 already decided for other settings.

### 2.3 Controller Routing & Presentation Layer

All routes: `SupabaseAuthGuard` + `CompanyMembershipGuard`; added to
`controller-auth-coverage.spec.ts` (currently 225).

| Verb | Path | Role | Notes |
|---|---|---|---|
| POST | `/bank-accounts` | Owner, Accountant | body: `ledger_account_id`, `kind`, `display_name`, `bank_name?`, `iban?`, `account_number_last4?`, `currency?` |
| GET | `/bank-accounts` | any member | `?include_inactive=` |
| GET | `/bank-accounts/:id` | any member | |
| PATCH | `/bank-accounts/:id` | Owner, Accountant | `display_name`, `bank_name`, `iban`, `account_number_last4`, `is_active`; `ledger_account_id`/`kind`/`currency` immutable once any line exists |
| PUT | `/bank-accounts/:id/opening-position` | Owner, Accountant | `{opening_balance, opening_balance_date}`; blocked once B1 has a completed reconciliation on the account |
| GET | `/bank-accounts/:id/balances` | any member | `?as_of=YYYY-MM-DD` → `{book_balance, bank_balance, bank_balance_source, bank_balance_date, difference}` |
| POST | `/bank-accounts/:id/imports` | Owner, Accountant | multipart `file`, `format=csv|ofx`, `mapping_profile_id?` → preview |
| POST | `/bank-accounts/:id/imports/:importId/commit` | Owner, Accountant | → counters |
| GET | `/bank-accounts/:id/imports` | any member | paginated (`limit`/`offset`, H-GL precedent) |
| GET | `/bank-accounts/:id/lines` | any member | `?from&to&recon_status&limit&offset`; `?format=csv` via existing `ReportsCsvInterceptor` pattern |
| POST/GET/PATCH | `/bank-csv-mapping-profiles[/:id]` | Owner, Accountant (write) | |

JSON field names are snake_case, as everywhere else in the API. Amounts are
strings with 2 dp, matching existing DTO serialisation (**Assumption** —
check `reports` DTOs when building; follow whatever they emit).

**Bilingual / presentation.** A1 has no outward document. Arabic/English
labels and PDF are not in A1 (C §9 presentation and H PDF/XLSX are deferred
project-wide). `description` is stored verbatim in whatever script the bank
used — never transliterated (B-3.4 precedent).

## 3. UAE Regulatory Compliance Anchors

| Anchor | Source | How A1 honours it |
|---|---|---|
| Bank statements are supporting records; 5 y VAT / 7 y CT; 7 y default when dual-relevant | Rules §2.5 | Files kept in Storage + `raw` per line; no delete path; retention purge is **not** built (no purge job exists anywhere — Open A-11) |
| Records producible in legible form on FTA request; Arabic translation may be requested | Rules §2.5 | `GET …/lines?format=csv`; original text preserved |
| No hard deletes | Rules §1.3 | No DELETE on any A1 table; exclude-with-audit only |
| Foreign-currency transactions record currency, rate, source, AED equivalent | Rules §1.3 | Line stores statement `currency`; AED equivalent/rate deferred to Q11 — **posting from non-AED lines is blocked in B1 until Q11 is answered** |
| Immutable audit log | Rules §1.24 | `audit_log` triggers on register + imports |

**Not applicable to A1 (stated so they are not silently assumed):**
AED 10,000 tax-invoice split (C §6.2 — sales documents only); CT 375,000
(G — reads the ledger; A1 does not post); the AED 55,000 cash threshold
(**not in any source document** — logged as Open A-12, no hook built).

## 4. Upstream/Downstream Event Pipelines

**Upstream.** HTTP import (A1); Lean scheduled pull (A2, Part II); C1
historical bulk import (`feature-spec-1_2_C.md`); B2 OCR PDF once wired
(`ocr_pdf`, insert only).

**Downstream.**

- No journal entry, no payment, no notification.
- Committed lines become B1's unreconciled queue.
- `bank_statement_imports.statement_closing_balance` feeds B1's statement
  balance and H's (future) close-checklist signal; no H change in A1.

## 5. Jest Testing & Verification Architecture

Repo convention: unit `*.spec.ts` beside the service; live-DB
`*.integration.spec.ts` that skip without keys; shared company setup from
`src/test/integration-company.setup.ts`.

| Test | Asserts |
|---|---|
| `bank-statement-parsers.spec.ts` (pure) | OFX 1.x SGML + 2.x XML fixtures → expected lines; CSV with debit/credit cols, signed col, `DD/MM/YYYY`; credit-card sign; row error on bad date (no guess) |
| `bank-dedupe.spec.ts` (pure) | same file twice → identical keys; two identical same-day rows → two keys; overlapping second file → overlap keys collide |
| `bank-accounts.service.spec.ts` | role gate (Staff → 403); credit card refused when ledger account is asset; `1000`/`1010`/`1070` refused |
| `bank-accounts.integration.spec.ts` | commit twice → `lines_duplicate = n`, no new rows; identical file hash → 409; UPDATE of `amount` on a line raises; DELETE raises; cross-company `bank_account_id` → 404 (membership isolation) |
| `bank-balances.integration.spec.ts` | post a D payment to the bank account's ledger account → book balance moves; bank balance = last committed closing balance |
| `controller-auth-coverage.spec.ts` | count 225 → 225 + new routes |

Fixtures live under `src/bank-accounts/__fixtures__/` as anonymised files.
No fixture is labelled with a real bank's name until that bank is validated
(A-10).

---

# Part II — A2: Lean Open Banking Live Feed

## 6. System Context & Business Objective

**Functional purpose.** Remove manual statement export for the seven
named banks (Emirates NBD, FAB, ADCB, Mashreq, RAK Bank, DIB, CBD) — **all
seven are unverified against Lean's coverage (Q3).** CSV/OFX stays the
permanent fallback.

**Technical goal.** A second *producer* into `bank_statement_lines`
(`source='lean'`), plus a live bank balance. Nothing in B1 changes because
of where a line came from.

## 7. Technical Feature Deep-Dive & Code Requirements

### 7.1 Data Intake & Database Constraints

```sql
create type bank_connection_status as enum ('pending_consent', 'active', 'expired', 'revoked', 'error');

create table bank_connections (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  bank_account_id       uuid not null references bank_accounts(id),
  provider              text not null default 'lean',
  provider_entity_id    text not null,      -- Lean entity / account reference
  status                bank_connection_status not null default 'pending_consent',
  consent_expires_at    timestamptz,
  last_pulled_through   date,               -- high-water mark for incremental pulls
  last_balance          numeric(18,2),
  last_balance_at       timestamptz,
  last_error            text,
  created_by            uuid not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (company_id, bank_account_id, provider)
);
```

**Secrets are not stored in this table.** Where tokens live (Supabase Vault
vs. env-managed KMS) is **Open A-13** — Build Order §3 requires confirming
the environment can hold bank credentials before scoping. RLS as §2.1.

### 7.2 Processing Mechanics & Business Logic

1. **Consent.** `POST /bank-connections` creates `pending_consent` and returns
   the Lean link payload the client needs; Lean's callback/webhook flips to
   `active` and stores `consent_expires_at`. Exact Lean API shapes are **not
   specified here** — not yet checked against Lean docs (Q3). Build a
   `LeanClient` interface + one adapter; tests use a fake.
2. **Scheduling.** Reuse `@nestjs/schedule` (already in `AppModule`). One
   cron enqueues one job per `active` connection. Execution uses BullMQ
   **only if Q12 confirms Redis**: copy the gate already in
   `document-submission.queue.ts` (`REDIS_URL` absent ⇒ queue not started;
   `attempts: 3`, exponential backoff). Without Redis the cron runs pulls
   sequentially in-process — `ponytail:` ceiling = one API process; upgrade
   path = BullMQ worker. Cron time: **Open A-14** (the shared 01:00 cron
   is a candidate, not a decision).
3. **Pull.** From `last_pulled_through − overlap` to today. Overlap days:
   **Open A-14** (overlap is safe because of the dedupe key, so the value is
   a cost/latency choice, not a correctness one). Insert via the same
   `commit_bank_statement_import` RPC with a synthetic import row
   (`source='lean'`). Advance `last_pulled_through` only after commit.
4. **Balance.** Store `last_balance` / `last_balance_at`; the A1 balances
   endpoint prefers it over the last statement when fresher.
5. **Expiry.** A pull that fails with consent expiry sets `expired` and
   records `last_error`. **No mailer exists** (H-R14), so surfacing is via
   `GET /bank-connections?status=expired` only.
6. **Revoke.** `POST /bank-connections/:id/revoke` → provider revoke + status
   `revoked`. Row is kept; no delete.

### 7.3 Controller Routing

| Verb | Path | Role |
|---|---|---|
| POST | `/bank-connections` | Owner |
| GET | `/bank-connections` | any member (`?status=`) |
| POST | `/bank-connections/:id/revoke` | Owner |
| POST | `/bank-connections/:id/pull` | Owner, Accountant — manual "pull now", same job path |
| POST | `/webhooks/lean` | **unguarded by membership**; verified by provider signature (pattern: `veryfi-webhook.controller.ts`); excluded from the guarded-route count the same way the Veryfi webhook is |

Connection consent is Owner-only (Proposed A-15) because it grants a third
party read access to company bank data.

## 8. UAE Regulatory Compliance Anchors

- Rules §1.21: every feed transaction must be matched or flagged unmatched —
  A2 lines land `unreconciled`; nothing auto-posts.
- Rules §2.5 retention applies to fed lines as to imported ones (`raw` keeps
  the provider payload).
- **Data residency / Open Finance obligations for UAE bank data: not in any
  source document.** Open (Q3) — must be answered before production, not
  assumed.

## 9. Upstream/Downstream

Upstream: cron; manual pull; Lean webhook. Downstream: new
`bank_statement_lines` rows → B1 queue; balance refresh. No ledger write,
no external webhook out.

## 10. Jest Testing

| Test | Asserts |
|---|---|
| `lean-pull.service.spec.ts` | fake `LeanClient`; overlapping pulls → no duplicate rows; failure leaves `last_pulled_through` unchanged; expiry → `expired` |
| `lean-webhook.controller.spec.ts` | bad signature → 401; good → status flip |
| Scheduler spec | no Redis ⇒ queue not constructed (mirror `document-batches.service.spec.ts` env toggle) |

No live Lean call in CI-equivalent runs (`JEST_WORKER_ID` gate, as the OCR
worker does).

---

# Decision log

| # | Decision | Status |
|---|---|---|
| A-1 | One staging table `bank_statement_lines` for all producers; A1 never posts | Proposed |
| A-2 | Bank account = register row bound 1:1 to a COA account; ledger is balance of record | Proposed (answers part of Q2) |
| A-3 | Signed `amount`, company perspective, `> 0` = money in; credit-card CSV must declare charge column | Proposed |
| A-4 | Dedupe key per source (FITID / Lean id / hashed tuple + occurrence index) | Proposed; CSV ceiling noted |
| A-5 | Per-account statement opening position on `bank_accounts`, not a journal | Proposed |
| A-6 | IBAN validation depth (format vs mod-97) | Open |
| A-7 | Credit card: last-4 only, no PAN | Proposed |
| A-8 | Deactivate blocked while unreconciled lines exist | Proposed |
| A-9 | Wrong import neutralised by `excluded` + audit, never deleted | Proposed |
| A-10 | Upload size cap; which banks' CSV profiles are validated | Open |
| A-11 | Retention purge after 7 years | Open — nothing purges today |
| A-12 | AED 55,000 cash threshold hook | **Open — not in Rules PDF, any module spec, or schema; needs a regulatory citation (owner 2026-10-20)** |
| A-13 | Token/secret storage for Lean | Open (Q3/Q12) |
| A-14 | Pull cron time and overlap window | Open |
| A-15 | Lean consent Owner-only | Proposed |
| Q1 | Feed-first vs ledger-first | **Open — owner instruction 2026-10-20: keep open** |
| Q2 | Credit-card liability COA account | Open — none in seed |
| Q11 | AED-only vs multi-currency | Open |
