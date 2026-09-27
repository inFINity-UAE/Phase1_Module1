# Module 1.1.B — AI Document Processing & OCR
## Feature Specification (Source of Truth) — DRAFT, not yet built

Part of Module 1.1 · AI-Based Accounting Foundation, inFINity Phase 1 (MVP).
**Status: 🟡 Draft.** Build Order §5 lists Module B as **Queued**, sequenced
fifth, after Module E. This document exists so B has a real spec to build
against once its turn comes — it is not itself a build authorization.

**Scope for this pass:** the core pipeline only — B1 document OCR in
English, plus duplicate detection, categorisation, and approval. Bank
statement import (B2, §0.4) is deferred to the next phase along with the
bank reconciliation engine it depends on; Arabic extraction (§3.4) is
deferred within this phase. See the decision log at the end.

OCR provider: **Veryfi** (owner-selected). This draft is grounded against
Veryfi's public API contract (checked 2026-09-21) and against
`Module_1_1_Build_Order_Scope.md` §5 and Module E's Bill entity (E-1). It
is now also grounded against the live `schema.sql` for B1's landing target
(§0.3) — checked this conversation, and it changed the design: extraction
can't land directly on `bills`, see §0.3 for why.

**Depends on:** Module 0 (ledger engine, to post the Bills B extracts),
Module 4 / E (the `bills` table B1 lands into, per E-1). BullMQ or
equivalent queue infra must be confirmed provisioned — Build Order §5
flags this as the first queue/worker requirement anywhere in the build
order.

**How to use this document:** Build Order §5 recommends splitting B into
sub-phases rather than one monolithic spec, because document OCR, bank
statement parsing, and email inbox monitoring are three different
technical problems. This draft follows that recommendation:

- **Part 0 (§0)** — cross-cutting decisions: OCR provider contract, landing
  targets, what's genuinely open before anyone can build against this.
- **Part I — B1, Document OCR** (§1–§5): camera/upload capture, extraction
  into a pre-bill staging table, confidence scoring, duplicate detection,
  auto-categorisation, approve/reject. Lands in a new `bill_extraction_meta`
  table first, then Module E's `bills` table once a document is complete
  enough to be a valid bill (§0.3, §2). **Schema-checked this conversation**
  — see §0.3 for what changed from the original assumption.
- **Part II — B2, Bank Statement Import** (§6–§7): PDF bank statement
  parsing for seven UAE banks. **Deferred to the next phase** — see §0.4.
  Kept in this doc as reference only; the bank reconciliation engine it
  depends on is not part of this build.
- **Part III — B3, Email Invoice Capture** (§8–§10): a per-customer inbound
  forwarding address — no OAuth, no inbox access. Reuses B1's extraction
  pipeline once an attachment arrives.

Do not treat this document as sign-off. Every numbered item in §0.2/§0.4
is an open decision, not a resolved one — the pattern every other module
spec in this repo uses (see e.g. `feature-spec-1_1_E.md` E-1, or
`feature-spec-1.1.H.md`'s H-R items) for "needs an owner decision before
this can be built," not "already decided."

---

# Part 0 — Cross-cutting

## 0.1 Why B1/B2/B3, not one build

Confirming Build Order §5's reasoning: B1 posts to `bills` (Module E,
built). B2 has no landing table anywhere in this schema (§0.4). B3 is a
capture channel that feeds B1, not a separate extraction problem. Building
all three as one PR risks shipping B2 half-built because B1 and B3 are
ready and B2 isn't — same failure mode the Build Order used to justify
sequencing B *after* E in the first place. Recommend committing to this
split before scoping starts, not discovering it mid-build.

## 0.2 Veryfi contract — what's confirmed vs. what needs a spike

Checked against Veryfi's current public docs (2026-09-21), not assumed
from memory:

| Claim in the feature list | Veryfi status | Action needed |
|---|---|---|
| JPG, PNG, PDF, HEIC, WebP | **Supported** on the Receipts & Invoices endpoint (`/api/v8/partner/documents`) — also `.bmp`, `.avif`, `.zip`. | None. |
| Arabic text extraction | Arabic **is** on Veryfi's supported-language list, and AED is a supported currency. | **Deferred out of this pass** (owner decision, this conversation) — see §1 / §3.4. No provider blocker when it's picked up; when it is, run the validation spike (20–30 real anonymized UAE Arabic invoices) before setting a confidence threshold, since language *support* isn't the same claim as field-level structured accuracy. |
| Confidence scoring per field | **Resolved — spike run against 3 real invoices.** Your plan returns `meta.ocr_score`, a single **document-level** score (0.966–0.987 across the sample), plus `is_duplicate` (boolean). No per-field confidence exists on this plan. | §3 below uses `ocr_score` as an additional signal alongside the rule-based flags, not a replacement — confirmed necessary, not just a safe default. |
| Batch upload, async processing | **Supported** — Receipts & Invoices endpoint has an async mode (`async: true`) with webhook callback, separate from the synchronous 3–5s path. | Use async + webhook for the batch queue (§4), not synchronous calls inside a BullMQ job loop — don't hold a worker open per document. |
| Bank Statement extraction | **Supported** as its own endpoint (`/api/v8/partner/bank-statements`), separate from Receipts & Invoices, also with async mode. | See §6 — the endpoint exists; the problem is Part II's landing target, not Veryfi's capability. |

## 0.3 Landing target for B1 — resolved, but not what §0.3 originally assumed

Build Order §4's instruction still holds — **B1 does not bypass Module E's
Bill entity or invent a parallel posting path.** But checking against the
live `schema.sql` (this conversation) found that the *mechanism* originally
assumed here was wrong: this draft previously assumed an OCR'd invoice
becomes a `bills` row in `draft` status with fields pre-filled. **That's
not possible.** `bills.supplier_id` and `bills.bill_date` are `NOT NULL`,
and every `bill_lines` row requires `description`, `quantity > 0`, and a
`vat_rate` — so a `bills` row cannot exist at all until a document is
already good enough to be a valid bill. Extraction that's missing a field,
has an unmatched vendor, or has a line with no parseable quantity has
**nowhere on `bills` to land**, correct or not.

**Resolved: a new pre-bill staging table, `bill_extraction_meta`,** holds
every extraction result — good or bad — with a nullable `bill_id`. A
`bills` row only gets created once the document is good enough to satisfy
E's constraints; until then, the extraction sits in staging and is what
§3's review queue actually shows the human, not a half-filled draft bill.
This is additive to E, not a change to it — no `bills`/`bill_lines`
constraint is relaxed, no status/numbering/approval/posting logic changes.

```sql
create table bill_extraction_meta (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references companies(id),
  bill_id                uuid unique references bills(id) on delete cascade,
  source_file_name       text not null,
  source_file_url        text not null,   -- Supabase Storage path, same pattern as journal_attachments.file_url
  source_file_size_bytes bigint,
  source_mime_type       text,
  veryfi_document_id     text not null,
  extracted_snapshot     jsonb not null default '{}'::jsonb,
  field_origin           jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint bill_extraction_meta_origin_check check (
    jsonb_typeof(field_origin) = 'object'
    and not exists (
      select 1 from jsonb_each_text(field_origin) o
      where o.value not in ('extracted', 'human_confirmed', 'human_edited')
    )
  )
);

create unique index bill_extraction_meta_company_veryfi_unique
  on bill_extraction_meta (company_id, veryfi_document_id);
create index idx_bill_extraction_meta_company
  on bill_extraction_meta (company_id);

alter table bill_extraction_meta enable row level security;

create policy company_isolation_bill_extraction_meta on bill_extraction_meta
  using (company_id = (select current_setting('app.current_company_id', true))::uuid);
```

`field_origin` keys are the §2 field names (plus `lines.<n>.<field>` for
line-level fields), each valued `extracted` / `human_confirmed` /
`human_edited` — this is what §3's flagging logic actually reads.
`extracted_snapshot` keeps the *raw* extracted values (vendor name text,
invoice number, date, line qty/price/totals, VAT amount, grand total) —
this matters because `bills`/`bill_lines` triggers recompute `line_total`,
`vat_total`, and `grand_total` from qty × price × rate and **discard**
whatever Veryfi extracted for those fields (§0.3.1 below). Without this
snapshot there'd be nothing left to compare against once a bill exists.

**In `schema.sql`.** Fresh databases get the table with the rest of the schema.
Live databases need this DDL applied before the extraction endpoints can insert.

### 0.3.1 Field-by-field mapping — confirmed against live schema

| Spec field (§2) | Column | Fit |
|---|---|---|
| Vendor name | `bills.supplier_id` (FK to `suppliers`) | **FK only — no vendor-name text column on `bills`.** A `bills` row can't exist until the extracted name is matched to an existing supplier or a new supplier row is created. Unmatched vendor = stays in `bill_extraction_meta`, no bill yet. |
| Invoice number | `bills.supplier_invoice_number` | Maps directly — **not** `bill_number`, which is the internal `BILL-YYYY-NNNN` allocated at Issue (E-16). Don't conflate the two. |
| Invoice date | `bills.bill_date` (`NOT NULL`) | Maps when parseable. Null/unparseable date blocks bill creation. |
| Line description, qty, unit price | `bill_lines.description`, `quantity` (`> 0` check), `unit_price` | Maps when all three are present; a missing or zero quantity is rejected by the schema, not just flagged. |
| Line total | `bill_lines.line_total` | Column exists but is **overwritten** by `trg_set_bill_line_computed_fields` (computed from qty × price − discount + VAT). The extracted line total is never stored on the row — only in `extracted_snapshot`. |
| VAT amount → rate + category | No per-line amount column — `bill_lines.vat_rate` **and** `bill_lines.vat_category`; header `bills.vat_total` | **Resolved — §0.3.2.** Not just a rate: `bill_lines.vat_category` is a separate required field, and `assert_bill_vat_ready` blocks Issue on a missing category (`BILL_LINE_MISSING_VAT_CATEGORY`). The standard rate itself is versioned (`effective_vat_standard_rate(bill_date)`, F-23), not a hardcoded 5%. |
| Total amount | `bills.grand_total` | Same trigger path — `subtotal + vat_total`, not client-writable. |
| Account (categorisation, §5.2) | `bill_lines.account_id` | Already nullable until Issue — matches §5.2's "leave blank, force human selection" design as-is. No change needed here. |

### 0.3.2 VAT amount → rate + category — resolved (corrected this conversation)

**The originally proposed "snap to 0% or 5%" approach is rejected — it
would have actively mislabeled invoices, not just approximated them.**
`bill_lines` stores two separate facts, `vat_rate` and `vat_category`, and
F-1 treats non-standard rates as genuinely different cases —
`zero_rated`, `exempt`, `out_of_scope`, `designated_zone` — not
interchangeable "not 5%." A reverse-charge bill also has `vat_rate = 0`
and *is* `standard_rated`, which a rate-only snap would have gotten
backwards. `suggest_bill_line_vat_fields` already reflects this: it only
fills `standard_rated` when the rate matches the actual standard rate,
and deliberately leaves every other rate's category null rather than
guessing.

**Resolved approach:**

1. Derive per line: `round(line_vat / line_net × 100, 2)`, when both
   amounts are present on the extraction.
2. If that equals `effective_vat_standard_rate(bill_date)` (F-23, from
   `vat_tax_rule_versions` — not a hardcoded 5) → set `vat_rate` to that
   rate, `vat_category` to `standard_rated`. Bill line is complete.
3. If it equals 0 — including the §3 case where VAT is null and the
   total equals the sum of the lines — set `vat_rate` to 0 and **leave
   `vat_category` null**. This does *not* auto-become `zero_rated`; a
   0-rate line is still one of four different facts (zero-rated, exempt,
   out-of-scope, designated-zone) or a reverse-charge standard-rated
   line, and only a human can say which. `assert_bill_vat_ready` already
   blocks Issue on a null category (`BILL_LINE_MISSING_VAT_CATEGORY`) —
   B1 doesn't need to invent its own gate here, E's existing constraint
   does the job. **A `bills` row can still be created** with this line in
   this state; it just can't reach Issue until a human sets the category,
   same as any other bill E already handles this way.
4. **Anything else stays in `bill_extraction_meta` — no `bills` row at
   all.** No tolerance band beyond `numeric(5,2)` rounding: §3 already
   refuses to guess a tolerance, and rounding to two decimal places is
   the only allowance, not an approximation on top of it.
5. A single header-level VAT amount (no per-line breakdown extracted) may
   only be applied uniformly across every line when that one ratio snaps
   to the standard rate. If lines are mixed and don't each individually
   snap, the whole document stays in review — no partial application.

## 0.4 B2 (bank statement import) — confirmed deferred to next phase

**Resolved (owner decision, this conversation): B2 is out of scope for
this build entirely, not just the posting side.** The bank reconciliation
engine is planned for the next phase, not this one, so there's no point
prototyping B2's extraction now either — it would sit unused until the
reconciliation engine it depends on exists. This section is kept as
context for that future phase, not as an active recommendation:

Module D's own deferral list (`feature-spec-1_1_D.md` §7, carried into
Build Order §3) already states that `1070 → 1020` clearing entries are
"**Later / bank-reconciliation module — manual JE until then**." No bank
reconciliation module exists in the build order — not built, not queued,
not numbered. "PDF bank statement import: extracts transactions from UAE
bank statement PDFs" needs somewhere structural for an extracted
transaction to land: a staging table, a match against existing
`journal_lines`/payments, a reconciled/unreconciled state. None of that
exists today, and per the phase decision above, it isn't being built in
this phase either.

This was the exact problem Build Order §5 used to justify sequencing B
*after* E ("building OCR before Accounts Payable's Bill entity exists
means building against a guess") — same reasoning, and now resolved the
same way: **defer the whole sub-module, not just part of it.**

- B2 (Part II below) is retained in this document only as a placeholder
  for the next phase — Veryfi's Bank Statement API details are noted for
  when that phase starts, but no work against it happens now.
- The **entire scope of B2 stays out of this build** until the bank
  reconciliation module is scoped with its own spec, the same way B itself
  was held out of scope until E existed.
- §6–§7 below are kept as reference for that future phase, not as
  in-scope work for this build.

---

# Part I — B1: Document OCR (invoices, receipts → Bill entity)

## 1. Scope

**In scope for B1:**

- Camera capture and file upload of vendor invoices and receipts —
  JPG, PNG, PDF, HEIC, WebP
- OCR extraction of vendor name, invoice number, date, line items, VAT
  amount, total amount, landing in `bill_extraction_meta` (§0.3) first —
  not directly on `bills`
- Confidence scoring with low-confidence extractions flagged for human
  review before a bill is even created (§3)
- Batch upload — up to 50 documents, background queue (§4)
- Duplicate detection against the existing ledger (§5.1)
- Auto-categorisation to Chart of Accounts from historical vendor/account
  patterns (§5.2)
- One-click approval — review, confirm/edit, **create the `bills` row and
  hand off to E's existing Bill flow** (§2 explains why this is a
  separate step, not a formality)
- Reject with reason, returned to uploader

**Out of scope for B1** (belongs to B2/B3 or a later pass): bank statement
parsing, email inbox monitoring, mobile edge-detection/auto-crop UI
(client-side capture UX, not an extraction-pipeline concern — track
separately against whatever mobile app shell exists), instant
categorisation suggestion mid-photo (same client-side note; also depends
on §5.2's model already existing before it can suggest anything "while the
photo is still being taken").

**Explicitly deferred, not built in this pass: Arabic text extraction**
(feature list item "Arabic text extraction — critical for UAE supplier
invoices"). Owner decision (this conversation): ship English-language
extraction first: Deferred, revisit once B1's core pipeline (extraction →
confidence → duplicate check → categorisation → approval) is working end
to end. Veryfi does list Arabic as a supported language (§0.2 table) so
there's no provider blocker when this is picked back up — it's a
sequencing choice, not a capability gap. Arabic invoices submitted before
this is built will still go through the pipeline in whatever language
Veryfi returns; they aren't rejected, just not a design target yet, so
expect lower accuracy on them until §3.4 (kept below for when this is
picked up) is implemented.

## 2. Extracted field set and the two-stage pipeline

**Resolved this conversation, corrects the original assumption in this
section:** extraction does not land directly on `bills`. It can't —
`bills`/`bill_lines` reject incomplete or invalid data by schema
constraint (§0.3.1), so a document that's missing a field or has an
unmatched vendor has no valid `bills` row to become yet. The actual flow:

1. **Extraction → `bill_extraction_meta`.** Every processed document
   creates one staging row here, `bill_id` null, holding the raw
   extraction (`extracted_snapshot`) regardless of how complete or clean
   it is.
2. **Confidence check (§3)** runs against the staging row. If everything
   required is present, valid, and unambiguous, the bill can be created
   immediately with the extraction pre-filled — this is the "clean"
   path a fast, well-scanned printed invoice takes.
3. **If anything's missing or invalid, the row stays in staging** and
   surfaces in the human review queue — not as a half-filled draft bill
   (there isn't one yet), but as a pending extraction. A human resolves
   it (matches/creates the vendor, fixes the date, corrects a line) which
   is what actually allows a `bills` row to be created.
4. **Once a `bills` row exists**, `bill_id` on the staging row is set,
   and everything from there on is E's existing lifecycle unchanged
   (`draft → matched → [pending_approval] → issued → ...`, E-1, E-25,
   E-26, E-28). B1 doesn't add a second approval path — it just moves
   the "is this good enough to be a bill yet" question earlier, into
   staging, instead of pretending an incomplete bill can exist.

| Spec field | Maps to | Note |
|---|---|---|
| Vendor name | `bills.supplier_id` via match/create against `suppliers` | FK only — see §0.3.1, this is the field most likely to block step 2 above |
| Invoice number | `bills.supplier_invoice_number` | Not `bill_number` — that's internally allocated at Issue (E-16) |
| Invoice date | `bills.bill_date` | `NOT NULL` — blocks bill creation if unparseable |
| Line items (description, qty, unit price) | `bill_lines.description` / `quantity` / `unit_price` | Quantity must be `> 0` per schema, not just "present" |
| Line total, VAT total, grand total | `bill_lines.line_total`, `bills.vat_total`/`grand_total` | **Not client-set** — recomputed by trigger from qty × price × rate once a bill exists. Extracted values live in `extracted_snapshot` for comparison (§3), not written here. |
| VAT amount → rate + category | `bill_lines.vat_rate`, `bill_lines.vat_category` | Resolved derivation — see §0.3.2. A zero-rate line with no category is not a block (E's own `assert_bill_vat_ready` already gates that at Issue); only a rate that doesn't cleanly snap to standard or zero is a block. |

## 3. Confidence scoring and review flagging

**Resolved — spike run against 3 real invoices (§0.2).** Veryfi returns
one document-level `meta.ocr_score` (0.966–0.987 in the sample) plus
`is_duplicate`, no per-field confidence. The rules below are the primary
mechanism, same as originally designed; `ocr_score` is folded in as one
additional signal, not a replacement. Note the rules serve double duty
per §2: they decide both "does this need a human before a `bills` row can
even be created" (rules 1–2, schema-enforced, not just policy) and "does
this need a human even though a bill technically could be created"
(rules 3–6).

**Flagged for mandatory human review, staying in `bill_extraction_meta`
with no `bills` row yet, if any of:**

1. Vendor name didn't resolve to an existing (or clearly creatable)
   supplier, invoice date is null/unparseable, or any line has no
   parseable quantity/description — **these aren't just review triggers,
   they're hard blocks**: no `bills` row can be created until resolved
   (§0.3.1).
2. Per-line VAT doesn't cleanly derive to either the standard rate or
   zero (§0.3.2, step 4) — **this is the only VAT case that blocks bill
   creation.** A line that derives to zero is *not* a block by itself
   (§0.3.2 step 3): `vat_rate = 0` with `vat_category` left null is a
   valid, storable state — `assert_bill_vat_ready` already prevents that
   bill from reaching Issue until a human sets the category, so B1 relies
   on E's existing constraint rather than duplicating it here. Same
   treatment applies to the §0.3.2 step 3 case where VAT is null and the
   total equals the sum of the lines (e.g. `INV-000018` in the spike,
   which genuinely has no VAT line) — the bill can be created; the
   category still needs a human before Issue, same as any other
   zero-rate line.

**Flagged for review even though a `bills` row could technically be
created, if any of:**

3. Extracted VAT + net doesn't match extracted total beyond `numeric(5,2)`
   rounding — compare against `extracted_snapshot`, since by the time a
   bill exists the schema's own trigger will have already recomputed
   `vat_total`/`grand_total` from rate, not from what was on the
   document. No tolerance band beyond that rounding — §0.3.2 step 4
   already refuses one.
4. Duplicate detection (§5.1) fired.
5. Auto-categorisation (§5.2) had no matching historical pattern.
6. `meta.ocr_score` falls below a threshold. **Open decision, not set
   yet** — the spike sample is only 3 documents, all fairly clean scans
   (0.966–0.987). That's too small to pick a real cutoff from; don't
   invent one from 3 data points. Proposal: log `ocr_score` on every
   document now, without gating on it, until enough production volume
   accumulates to see where genuinely bad scans actually score, then set
   the threshold from real data rather than a guess.

**New edge case found by the spike, not previously considered:**
`SO-00128` is a **proforma invoice** ("P.I# SO-00128" on the page, not a
final invoice), and Veryfi left `invoice_number` empty even though a
reference is visible on the document — it's not a bad extraction, the
document itself isn't a final invoice. This is caught by rule 1 as-is
(null invoice number blocks bill creation, so it correctly lands in
review rather than becoming a bill), but it raises a question the spec
hadn't asked: **should proforma invoices be accepted as bills at all, or
specifically detected and rejected with a reason** ("this is a proforma,
not a final invoice — please upload the final invoice when available")
rather than sitting in the generic review queue indistinguishable from a
genuinely bad scan? Open decision — not blocking B1's build, but worth
deciding before the review-queue UI is designed, since the correct human
action is different for the two cases.

Rule 3's tolerance is fixed at `numeric(5,2)` rounding, not an open
band — §0.3.2 step 4 already settled that; nothing further to decide
here.

### 3.4 Arabic — deferred, kept here for when it's picked back up

**Not built in this pass** — see the deferral note in §1. Kept as a
placeholder so the later work has a starting point instead of a blank
page: extraction would proceed the same as English; Arabic-sourced text
stored as-is (no transliteration), since it's needed for supplier-facing
correspondence and audit, not just internal posting. Vendor-name matching
(§5.1, §5.2) against existing `suppliers` records would need a decision on
whether matching is script-aware (an Arabic invoice from a vendor
previously entered in English needs to resolve to the same supplier). The
validation spike in §0.2 (20–30 real anonymized UAE Arabic invoices
against Veryfi, to set a realistic confidence threshold) should happen
before, not during, that build — don't reopen this section without it.

## 4. Batch upload and queueing

**Two separate queues, not one — corrected this conversation, was
conflated before:**

1. **Submission side (BullMQ, not yet provisioned).** Orchestrates
   submitting up to 50 documents per batch without blocking a request —
   this is the part that's genuinely pending on infra (§0.4/Build
   Order §5) and needs BullMQ or an equivalent stood up before batch
   upload can ship.
2. **Completion side (Veryfi's own async queue, already available,
   independent of BullMQ).** Each document is submitted with
   `async: true`; Veryfi processes it on their side and calls our webhook
   back on completion. The webhook receiver is just an HTTP endpoint —
   it doesn't depend on BullMQ existing, and it **does not create a
   draft `bills` row directly.** Per §0.3/§2, it writes (or updates) the
   corresponding `bill_extraction_meta` row with the extraction result,
   then runs §3's rules: if everything required is present and valid, a
   `bills` row is created immediately; otherwise the row stays in
   staging for human review. A single document can be processed via the
   webhook path today, without BullMQ — BullMQ is specifically for
   orchestrating a 50-document batch's submission, not a prerequisite
   for OCR landing anywhere.

Do not call Veryfi synchronously inside a worker loop for batches — that
serializes 50 documents behind Veryfi's per-call latency instead of
processing them in parallel. Rate limit against Veryfi's documented
60 req/s cap on the Receipts & Invoices endpoint.

## 5. Duplicate detection and auto-categorisation

### 5.1 Duplicate detection — resolved

**Resolved (owner decision, this conversation):**

- **Rule 1 (exact match):** same `supplier_id` + exact `invoice_number` →
  100% duplicate. Foolproof whenever an invoice number exists.
- **Rule 2 (heuristic match):** same `supplier_id` + same `total_amount`
  (or within ±AED 1) + `date` within ±3 days → flagged as a likely
  duplicate. The ±3-day window accounts for the gap between an invoice's
  issue date and when it actually gets entered or clears the bank. The
  ±AED 1 tolerance (rather than requiring an exact amount) accounts for
  FX conversion differences, minor digital wallet fees, or tax-rounding
  differences that can put an invoice total and a bank debit line one
  dirham apart even when they're the same transaction.

Rule 1 hits are treated as certain duplicates; Rule 2 hits are treated as
*likely* and routed to human review (§3's flagging rule) rather than
auto-rejected, since a heuristic match can still be a coincidence — two
genuinely different invoices from the same supplier for the same round
amount within a few days of each other, for instance.

### 5.2 Auto-categorisation — resolved

Model: maintain a `supplier_id → expense/asset account_code` mapping
learned from bills a human has already approved (i.e., every one-click
approval in §1 is a training signal, not just a posting event). On a new
bill from a known supplier with a consistent history, pre-fill the
account; on an unknown supplier or a supplier with mixed history, **leave
the account blank and require human selection** — same posture as §3's
review flag rule.

**Resolved (owner decision, this conversation):** forcing manual
selection for new/unclear vendors, rather than auto-guessing or routing
through a suspense account, is the confirmed approach. Auto-guessing
risks silently miscategorising an expense; a suspense-account fallback
just defers the same cleanup to a messier place later. Blank + forced
human choice keeps the ledger clean from the first posting, at the cost
of new vendors not getting the one-click-approve experience the first
time.

---

# Part II — B2: Bank Statement Import (deferred to next phase — see §0.4)

## 6. Scope — not built this phase

**Deferred in full, not just the posting side.** Kept here only as
reference for when the bank reconciliation engine is scoped:

Calling Veryfi's Bank Statement API (`/api/v8/partner/bank-statements`,
async-capable) against PDF statements would return a structured
transaction list (date, description, debit, credit, balance) — Veryfi's
endpoint returns this generically; it isn't UAE-bank-specific, so
"auto-identifies columns regardless of format" would mostly be Veryfi's
existing normalization, not new work, when this is picked up.

**Out of scope for this phase entirely:** extraction, posting, matching,
everything. There is no partial B2 in this build.

## 7. Per-bank validation — open, not assumed

The feature list names seven formats: Emirates NBD, FAB, ADCB, Mashreq,
RAK Bank, DIB, CBD. Veryfi's Bank Statement model is generic across banks
and currencies rather than pre-trained per named UAE bank. **Before
committing to "supports these seven,"** run one real (anonymized)
statement per bank through the endpoint and check column-mapping accuracy
— don't list a bank as supported on the strength of Veryfi supporting
bank statements in general. This is the same posture as the Arabic spike
in §0.2: a general capability claim isn't a per-format accuracy guarantee.

---

# Part III — B3: Email Invoice Capture

## 8. Scope — forwarding address, not OAuth inbox access

**Resolved (owner decision, this conversation): a per-customer inbound
forwarding address, not an OAuth inbox connection.** Rejecting the
OAuth-scan option outright: requiring customers to grant read access to
their real business mailbox is a hard sell for a lot of SMEs regardless
of how the permission is scoped, and for Gmail specifically it would also
mean clearing Google's CASA security review before going live. This spec
no longer treats OAuth as the chosen path — see §8.1 for what's kept for
reference only.

**How it works:** every customer/tenant gets a unique inbound email
address on signup (e.g. `invoices-<tenant-id>@inFINity-mail.com`, exact
domain/format TBD). The customer — or, more usefully, their suppliers
directly — sends or CCs invoices to that address instead of the
customer's real inbox. inFINity's mail handler receives it, pulls any
attachment, and pushes it into the **same B1 pipeline** (§1–§5): same
extraction, same confidence rules, same duplicate check, same approval
flow. B3 is a capture channel, not a second extraction system.

This requires **no OAuth, no mailbox permission, and no CASA review** —
inFINity never touches a customer's actual Gmail/Outlook/Zoho account.
It's also the simpler build: one inbound-mail integration instead of two
separate provider OAuth flows to maintain. The trade-off, worth being
explicit about since it affects how this gets marketed to customers:
it's not a passive "AI watches your inbox" feature — someone (ideally the
supplier, cc'd once and reused going forward) has to actually send mail
to the forwarding address. It removes the manual download-and-upload
step, not the forwarding step itself.

### 8.1 Kept for reference only — the OAuth option that was rejected

Not in scope, not being built. Noted here only so the reasoning isn't
lost: Gmail (`gmail.readonly`, CASA-gated) and Outlook (`Mail.Read`
delegated + `offline_access`) both support scoped, read-only, per-customer
OAuth connections, and there's no technical blocker to building this
later if forwarding-address adoption turns out to be too manual for
customers. If revisited, start from this section's original design
rather than from scratch.

## 9. Open build details

1. Forwarding-address format and domain — needs a decision, but low
   stakes (e.g. `invoices-<tenant-id>@...` vs. a random token-based
   address; a token is harder to guess/spoof but less legible to a human
   forwarding mail manually).
2. Attachment-only vs. inline-invoice detection — some suppliers may
   paste an invoice as email body text rather than attaching a file; is
   that in scope for OCR, or attachment-only for now?
3. Spoofing/validation — anyone who learns a customer's forwarding
   address could technically send junk into their bill queue. Since
   nothing auto-posts without human approval (§1), the immediate risk is
   review-queue noise rather than a bad posting, but worth a basic
   sender-allowlist or domain-matching check against known suppliers if
   this becomes a problem in practice.
4. False-positive handling: what happens when B3 receives something that
   isn't actually an invoice — does it silently skip, or queue for human
   triage the same way a low-confidence B1 document does?

---

# Decision log

| # | Decision | Status |
|---|---|---|
| B-0.1 | Scope split into B1/B2/B3 per Build Order §5 recommendation | Proposed this draft — needs owner sign-off |
| B-0.2 | Veryfi capability contract vs. feature-list claims (confidence-field, Arabic accuracy) | Checked against Veryfi docs 2026-09-21. **Confidence-field spike done and resolved this conversation** — plan returns document-level `ocr_score` only, no per-field confidence (§3). Arabic sample spike still pending, deferred with §3.4. |
| B-0.3 | B1 landing target: `bill_extraction_meta` staging table (new, additive) feeds `bills` once E's constraints are satisfiable | **Resolved — checked against live schema.** Original assumption (extraction lands directly as a draft `bills` row) was wrong. Table is in `schema.sql`. |
| B-0.3.2 | VAT amount → VAT rate + category derivation for `bill_lines.vat_rate`/`vat_category` | **Resolved — owner rejected the original rate-only-snap approach and specified the correct derivation** (per-line ratio → standard rate/`standard_rated`, or 0/null-category, or stays in staging; no tolerance beyond `numeric(5,2)`; header VAT only applies uniformly when it snaps to standard). See §0.3.2. |
| B-0.4 | B2 (bank statement import) deferred to next phase, in full | **Resolved — owner confirmed bank reconciliation engine is next-phase, not this one** |
| B-5.1 | Duplicate-detection match key and tolerances (exact-match rule + ±3-day/±AED 1 heuristic rule) | **Resolved — owner confirmed both rules and tolerances** |
| B-5.2 | Auto-categorisation: blank + forced manual selection for new/unclear vendors, no suspense posting | **Resolved — owner confirmed** |
| B-9 | Email capture: per-customer inbound forwarding address, no OAuth/inbox access | **Resolved — owner rejected OAuth (Gmail/Outlook access is a hard ask for many customers); forwarding address chosen instead.** Address format, inline-body detection, and spoofing/validation remain open (§9). |
| B-3.4 | Arabic text extraction | **Deferred out of this pass** (owner decision) — English-only build first; §3.4 kept as a starting point for when it's picked back up |
| B-3.6 | `ocr_score` review threshold | Open — not set. Spike sample (3 documents) too small to pick a real cutoff; proposal is to log the score now and set the threshold once real volume shows where bad scans actually land |
| B-3.7 | Proforma invoice handling — accept into generic review queue vs. detect and reject with a specific reason | Open — surfaced by the spike (`SO-00128`), not previously considered; doesn't block B1's build but affects review-queue UX design |
| B-4 | §4 webhook/queue design — was contradicting §0.3 (said webhook creates a draft `bills` row directly) and conflating BullMQ with Veryfi's own async completion queue | **Resolved — corrected this conversation.** Webhook writes to `bill_extraction_meta`, not `bills`, and works today independent of BullMQ; BullMQ is specifically for batch-submission orchestration, still pending infra. |

No item above marked "Open" is closed. Resolved items are settled per this
conversation; open items still need sign-off before their section can be
built — same status convention as the H-R items in
`feature-spec-1.1.H.md` §14.