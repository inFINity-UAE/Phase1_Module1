# Module 1.1.B — AI Document Processing & OCR
## Feature Specification (Source of Truth) — DRAFT, not yet built

Part of Module 1.1 · AI-Based Accounting Foundation, inFINity Phase 1 (MVP).
**Status: 🟡 Draft.** Build Order §5 lists Module B as **Queued**, sequenced
fifth, after Module E. This document exists so B has a real spec to build
against once its turn comes — it is not itself a build authorization.

OCR provider: **Veryfi** (owner-selected). This draft is grounded against
Veryfi's public API contract (checked 2026-09-21) and against
`Module_1_1_Build_Order_Scope.md` §5 and Module E's Bill entity (E-1). It is
**not** grounded against `schema.sql`, because B has no tables of its own
yet — see §0.3. That grounding pass is required before build, same as every
other module in this repo.

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
- **Part I — B1, Document OCR** (§1–§5): camera/upload capture, extraction,
  Arabic + handwriting, confidence scoring, duplicate detection,
  auto-categorisation, approve/reject. Lands in Module E's `bills` table.
  **This part can be scoped now** — its dependency (E) is built.
- **Part II — B2, Bank Statement Import** (§6–§7): PDF bank statement
  parsing for seven UAE banks. **This part is blocked** — see §0.4. It has
  no landing target in the current schema.
- **Part III — B3, Email Invoice Capture** (§8–§9): Gmail/Outlook inbox
  monitoring. Reuses B1's extraction pipeline once an attachment is found.

Do not treat this document as sign-off. Every numbered item in §0.2/§0.4
is an open decision, not a resolved one — the pattern every other module
spec in this repo uses (see e.g. `feature-spec-1_1_E.md` E-1, or
`feature-spec-1_1_H.md`'s H-R items) for "needs an owner decision before
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
| **TIFF** | **Not in Veryfi's supported-format list** for Receipts & Invoices, AnyDocs, or Checks. Only their internal *check-image* pipeline emits TIFF (banking-standard output, not an input format anyone can upload). | Either drop TIFF from B1's accepted-upload list, or add a server-side TIFF→PDF/PNG conversion step before the file reaches Veryfi. Don't assume Veryfi accepts it — it doesn't, per their own docs. |
| Arabic text extraction | Arabic **is** on Veryfi's supported-language list, and AED is a supported currency. | Language *support* is not the same claim as field-level structured accuracy on a UAE tax invoice with mixed Arabic/English labels and Arabic-Indic digits. Recommend a validation spike: run 20–30 real (anonymized) UAE supplier invoices through Veryfi before setting the confidence threshold in §3, not after. |
| Confidence scoring per field | **Not confirmed.** Veryfi's public docs describe document-level signals (e.g. `is_duplicate`) but a *per-field* confidence score on every extracted field is not something the general docs guarantee — it may be plan-dependent. | Confirm with Veryfi (your account rep or a sandbox call) exactly which confidence signals your plan returns before §3's review-flagging logic is designed around a field it might not have. §3 below specifies a rule-based fallback that doesn't depend on Veryfi supplying this. |
| Handwritten receipts | Veryfi handles printed receipts well; handwriting accuracy is materially lower industry-wide for any OCR engine, which is presumably why the feature list already asks for a Claude API fallback. | Define the *trigger* for the fallback precisely — see §3.3. "Unclear or ambiguous" isn't an implementable condition on its own. |
| Batch upload, async processing | **Supported** — Receipts & Invoices endpoint has an async mode (`async: true`) with webhook callback, separate from the synchronous 3–5s path. | Use async + webhook for the batch queue (§4), not synchronous calls inside a BullMQ job loop — don't hold a worker open per document. |
| Bank Statement extraction | **Supported** as its own endpoint (`/api/v8/partner/bank-statements`), separate from Receipts & Invoices, also with async mode. | See §6 — the endpoint exists; the problem is Part II's landing target, not Veryfi's capability. |

## 0.3 Landing target for B1 — reuses E, no new tables (pending confirmation)

Build Order §4 is explicit: Module E's Bill entity (`bills` table, decision
E-1) "*is also the landing target for Module 5 (B — OCR). Do not reopen
the question when scoping B.*" This spec follows that instruction: **B1
does not introduce a new document/extraction table.** An OCR'd invoice
becomes a `bills` row in `draft` status with fields pre-filled from
extraction instead of manual entry (§5).

This draft has not been checked against `schema.sql`'s actual `bills`
column list — that file wasn't provided in this pass. Before build,
confirm the extracted-field set (§2) maps cleanly onto existing `bills` /
`bill_lines` columns, and that nothing here requires a schema migration
E's design didn't anticipate (e.g. a place to store the source document
image, the Veryfi document ID, or which fields were auto- vs.
human-confirmed).

## 0.4 B2 (bank statement import) has no landing target — flag before scoping

This is the one item in the feature list this draft actively pushes back
on scoping yet, not just a detail to fill in later:

Module D's own deferral list (`feature-spec-1_1_D.md` §7, carried into
Build Order §3) already states that `1070 → 1020` clearing entries are
"**Later / bank-reconciliation module — manual JE until then**." No bank
reconciliation module exists in the build order — not built, not queued,
not numbered. "PDF bank statement import: extracts transactions from UAE
bank statement PDFs" needs somewhere structural for an extracted
transaction to land: a staging table, a match against existing
`journal_lines`/payments, a reconciled/unreconciled state. None of that
exists today.

This is the exact problem Build Order §5 used to justify sequencing B
*after* E ("building OCR before Accounts Payable's Bill entity exists
means building against a guess"). The same reasoning applies here: scoping
B2 now means guessing at a bank-reconciliation data model that hasn't been
designed, and very likely reworking B2 once that module is. Recommend:

- Extraction itself (Veryfi Bank Statement API call → structured
  transaction list) can be prototyped now since it's provider-side work,
  not schema work.
- The **posting/matching side of B2 stays out of scope** until a bank
  reconciliation module is scoped with its own spec, the same way B itself
  was held out of scope until E existed.
- §6–§7 below describe extraction only, and mark the landing step
  explicitly TBD.

---

# Part I — B1: Document OCR (invoices, receipts → Bill entity)

## 1. Scope

**In scope for B1:**

- Camera capture and file upload of vendor invoices and receipts —
  JPG, PNG, PDF, HEIC, WebP (TIFF: see §0.2, conversion step or drop)
- OCR extraction of vendor name, invoice number, date, line items, VAT
  amount, total amount
- Handwritten receipt support with a Claude API fallback (§3.3)
- Arabic text extraction for UAE supplier invoices (§3.4)
- Confidence scoring with low-confidence fields flagged for human review
  before posting (§3)
- Batch upload — up to 50 documents, background queue (§4)
- Duplicate detection against the existing ledger (§5.1)
- Auto-categorisation to Chart of Accounts from historical vendor/account
  patterns (§5.2)
- One-click approval — review, confirm/edit, post to ledger via E's
  existing Bill flow
- Reject with reason, returned to uploader

**Out of scope for B1** (belongs to B2/B3 or a later pass): bank statement
parsing, email inbox monitoring, mobile edge-detection/auto-crop UI
(client-side capture UX, not an extraction-pipeline concern — track
separately against whatever mobile app shell exists), instant
categorisation suggestion mid-photo (same client-side note; also depends
on §5.2's model already existing before it can suggest anything "while the
photo is still being taken").

## 2. Extracted field set

| Field | Maps to (pending §0.3 schema check) |
|---|---|
| Vendor name | Match/create against `suppliers` (Module E) |
| Invoice number | `bills.bill_number` or supplier-invoice-number equivalent |
| Invoice date | `bills` date field |
| Line items (description, qty, unit price, line total) | `bill_lines` |
| VAT amount | Input VAT `1400` side, per bill line where applicable |
| Total amount | `bills` total |

Every extracted field lands as a **draft** — nothing here bypasses E's
existing Bill lifecycle (`draft → matched → [pending_approval] → issued →
partially_paid/paid`, E-1) or its three-way-match / approval-threshold
rules (E-25, E-26, E-28). B1 pre-fills a `bills` row; it does not add a
second approval path around it.

## 3. Confidence scoring and review flagging

Because Veryfi's per-field confidence signal is **not confirmed** (§0.2),
this spec proposes a rule-based flag that doesn't depend on it, and treats
any genuine Veryfi confidence field as an *additional* signal once
confirmed, not the only one:

**A bill is flagged for mandatory human review before posting if any of:**

1. `vendor_name`, `invoice_number`, `date`, or `total_amount` came back
   null/unparseable
2. VAT amount is present on the source but couldn't be extracted, or
   extracted VAT + net ≠ extracted total beyond a small rounding tolerance
3. The Claude API fallback (§3.3) was triggered at all
4. Duplicate detection (§5.1) fired
5. Auto-categorisation (§5.2) had no matching historical pattern

**Open decision:** rounding tolerance for #2, and whether Veryfi's own
confidence field (once confirmed) should add *more* auto-flag conditions
or should replace some of the above. Don't guess a number — get it from a
sample of real invoices in the validation spike (§0.2).

### 3.3 Claude API fallback — trigger condition

"Unclear or ambiguous" needs a concrete trigger, not a vibe. Proposed:
fallback fires when Veryfi returns the document successfully but one or
more of the required fields (§2) is null, or Veryfi's own status
indicates low confidence (once §0.2's spike confirms that signal exists).
On fallback, the source image is sent to Claude's vision API with a
structured-extraction prompt for the same field set, and the result is
merged in — Claude-sourced fields are always flagged for review (rule #3
above) regardless of how confident Claude itself sounds, since this is
the fallback path for the hardest documents.

### 3.4 Arabic

Extraction proceeds the same as English; Arabic-sourced text is stored
as-is (no transliteration) with the original script, since it's needed
for supplier-facing correspondence and audit, not just internal posting.
Vendor-name matching (§5.1, §5.2) against existing `suppliers` records
needs a decision on whether matching is script-aware (an Arabic invoice
from a vendor previously entered in English needs to resolve to the same
supplier) — flagged as open, not solved here.

## 4. Batch upload and queueing

Up to 50 documents per batch, processed via BullMQ (pending infra
confirmation, Build Order §5). Each document is submitted to Veryfi with
`async: true`; a webhook receiver updates job status and, on completion,
creates the draft `bills` row. Do not call Veryfi synchronously inside a
worker loop for batches — that serializes 50 documents behind Veryfi's
per-call latency instead of processing them in parallel. Rate limit
against Veryfi's documented 60 req/s cap on the Receipts & Invoices
endpoint.

## 5. Duplicate detection and auto-categorisation

### 5.1 Duplicate detection

Proposed default match key: same `supplier_id` + same `invoice_number`
(exact), **or** same `supplier_id` + same `total_amount` + `date` within
a small window (proposed ±3 days, to catch re-scans of the same paper
invoice entered on a different day). **Open decision:** the owner needs
to confirm both the date window and whether amount match should be exact
or tolerance-banded (e.g. ±AED 1 for rounding). Don't ship a hardcoded
number without sign-off — this is exactly the kind of threshold Module E
logged explicitly (E-26 quantity/price tolerance) rather than assumed.

### 5.2 Auto-categorisation

Proposed model: maintain a `supplier_id → expense/asset account_code`
mapping learned from bills a human has already approved (i.e., every
one-click approval in §1 is a training signal, not just a posting event).
On a new bill from a known supplier with a consistent history, pre-fill
the account; on an unknown supplier or a supplier with mixed history,
leave the account blank and require human selection — same posture as
§3's review flag rule #5. No suspense-account posting is needed here
(unlike H's `1910`/`2900` suspense pattern) because §1 already routes
every bill through human approval before Issue; nothing auto-posts
uncategorised.

---

# Part II — B2: Bank Statement Import (extraction only — see §0.4)

## 6. Scope

**In scope for this pass:** calling Veryfi's Bank Statement API
(`/api/v8/partner/bank-statements`, async-capable) against PDF statements
and getting back a structured transaction list (date, description, debit,
credit, balance) — Veryfi's endpoint returns this generically; it isn't
UAE-bank-specific, so "auto-identifies columns regardless of format" is
mostly Veryfi's existing normalization, not new work.

**Explicitly out of scope until a bank-reconciliation module is spec'd
(§0.4):** posting extracted transactions anywhere, matching them against
existing ledger entries, marking anything reconciled/unreconciled, or any
UI implying the import is "done" once extracted.

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

## 8. Scope

Connect Gmail or Outlook; detect and extract supplier invoices arriving
as email attachments or inline. Once a document is identified, it enters
the **same B1 pipeline** (§1–§5) — same extraction, same confidence
rules, same duplicate check, same approval flow. B3 is a capture channel,
not a second extraction system.

Veryfi's email-collector path (a dedicated inbound address) is a
different integration shape than an OAuth'd Gmail/Outlook connector that
scans an existing inbox — confirm which one is actually wanted before
building. An inbound collector address is far less invasive (no inbox
read-scope) but requires the user to forward or CC invoices; direct inbox
scanning is more automatic but is a materially bigger privacy/consent
surface (OAuth scope, which folders, how far back, revocation).

## 9. Open decisions

1. Inbound-collector-address vs. OAuth inbox-scan — pick one; they are not
   the same feature.
2. If inbox-scan: exact OAuth scopes requested, folder/label scope, and a
   retention/consent story for a feature that reads someone's email.
3. False-positive handling: what happens when B3 flags something as an
   invoice that isn't one — does it silently skip, or queue for human
   triage the same way a low-confidence B1 document does?

---

# Decision log

| # | Decision | Status |
|---|---|---|
| B-0.1 | Scope split into B1/B2/B3 per Build Order §5 recommendation | Proposed this draft — needs owner sign-off |
| B-0.2 | Veryfi capability contract vs. feature-list claims (TIFF gap, confidence-field, Arabic accuracy) | Checked against Veryfi docs 2026-09-21 — spikes still needed (Arabic sample set, per-bank sample set, confidence-field confirmation) |
| B-0.3 | B1 lands in Module E's `bills` table, no new table | Reaffirms Build Order §4 instruction — not yet checked against live `schema.sql` |
| B-0.4 | B2 posting/matching is out of scope pending a bank-reconciliation module | **This draft's position — needs owner confirmation, since it narrows the original feature list** |
| B-5.1 | Duplicate-detection match key and tolerances | Open — proposed default given, needs sign-off like E-26 |
| B-5.2 | Auto-categorisation model (learned vendor→account mapping, no suspense posting) | Proposed this draft |
| B-9 | Email capture: inbound address vs. inbox OAuth scan | Open — blocks any B3 scoping until picked |

No item above is closed. This spec is a starting point for scoping B, not
a build authorization — same status as the H-R items in
`feature-spec-1_1_H.md` §14 until each gets its own resolved decision.
