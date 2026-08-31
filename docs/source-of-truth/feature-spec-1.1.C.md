# Module 1.1.C — Quotations & Tax Invoicing (FTA-Compliant)
## Feature Specification (Source of Truth)

Part of Module 1.1 · AI-Based Accounting Foundation, inFINity Phase 1 (MVP).
This is the authoritative feature list for Module 1.1.C only — do not infer
scope from Module 1.1.A/H1 or other 1.1.B–H modules.

**How to use this document:** Sections 1–9 state the current, effective
rules — read these as the standing spec, not a history. Section 11 is a
chronological decision index for traceability; every rule above is sourced
from a numbered, dated decision there. Section 10 lists genuinely open
items still to be resolved before or during build — everything else in
this document is settled, not provisional.

**Scope for this pass (C1):** quotations (**C1-2**), tax invoices (**C1-3**), credit notes, and
their ledger integration. Everything else from the source feature list's
section C is explicitly out of scope — see §9.

**Dependencies confirmed clear before this document was finalized:**
Module 1.1.A is complete through decision #63 (unattended recurring
generation, including its own failure-recovery path) — the scheduling
infrastructure §8 of this document depends on is real and tested, not
assumed. The finalized `Chart_of_Accounts_-_inFINity.xlsx` was consulted
directly for every account-numbering decision below, per the same
discipline Module 1.1.A applied to its own COA-derived decisions
(#12–16).

---

## 1. New entities

### 1.1 `customers`

Columns: `id`, `company_id`, `customer_name`, `trn` (nullable — not
every customer is VAT-registered), `email`, `phone`, `billing_address`,
`default_payment_terms`, `is_active`, `created_at`, `updated_at`.

`unique(company_id, trn) where trn is not null` — a partial unique
index, same shape as `accounts(company_id, account_number)`. Two
customer records sharing a TRN within one company would represent the
same legal entity recorded twice. *(Decision #1)*

`trn` is set at creation only — not patchable afterward. Changing a
customer's TRN after documents exist would effectively re-identify the
legal entity; immutability matches decision #1's intent and avoids silent
invoice-type drift (§6.2). To correct a wrong TRN: deactivate this
record and create a new one. *(Decision #17)*

`is_active = false` is a soft deactivate (`PATCH …/deactivate`), not a
hard delete. Future quotation/invoice modules must reject **new**
documents referencing inactive customers; existing quotations/invoices
are never retroactively altered. *(Decision #1 implementation note)*

`customers.trn` is a functional field, not just contact metadata — its
presence or absence directly drives invoice-type selection (§6.2).

### 1.2 `quotations` + `quotation_lines`

Header + line items, structurally mirroring `journal_entries` +
`journal_lines` but not a ledger object — a quotation never touches
`journal_entries` unless and until it converts to an invoice (§4).

`quotations`: `id`, `company_id`, `customer_id`, `quotation_number`
(§3), `quotation_date`, `valid_until`, `status` (§2.1), `subtotal`,
`vat_total`, `grand_total`, `notes`, `converted_to_invoice_id`
(nullable, set on conversion), `created_by`, `created_at`, `updated_at`.

`quotation_lines`: `id`, `quotation_id`, `line_number`, `description`,
`quantity`, `unit_price`, `discount_percent`, `discount_amount`,
`vat_rate`, `line_total`.

`discount_percent` and `discount_amount` are mutually exclusive — a
CHECK constraint enforces exactly one is set or neither, matching the
XOR-style pattern `journal_lines` already uses for debit/credit.
*(Decision #2)*

`subtotal`/`vat_total`/`grand_total` are DB-computed from the current
line items via `recalculate_quotation_totals` (AFTER INSERT/UPDATE/DELETE
on `quotation_lines` while parent `status = 'draft'`), never client-set —
consistent with Module 1.1.A decision #10's "never trust client input
for what the backend can derive." The header UPDATE does not re-fire
line triggers (no recursion): `quotations` has no AFTER trigger on
`quotation_lines`, and the only quotation-line triggers are BEFORE
(`prevent_nondraft_*`, `set_quotation_line_computed_fields`) plus this
single AFTER refresh — verified by `integration_verify_quotation_recalc_fires_once`
(same-transaction trace: one line UPDATE → one AFTER fire → one recalc).
Once non-draft, the header (and its now-final totals) locks via
`prevent_nondraft_quotation_header_mutation` and
`prevent_quotation_computed_totals_mutation` (session GUC allows only
the recalc trigger to write totals). *(Decision #3)*

### 1.3 `invoices` + `invoice_lines`

`invoices`: `id`, `company_id`, `customer_id`, `invoice_number` (§3),
`invoice_type` (`tax_invoice` | `simplified_tax_invoice` | `proforma`),
`invoice_date`, `due_date`, `payment_terms` (§5), `status` (§2.2),
`subtotal`, `vat_total`, `grand_total`, `amount_paid`,
`source_quotation_id` (nullable), `journal_entry_id` (nullable until
Issued — §7), `void_reason` (nullable, required when `status = 'void'`),
`created_by`, `created_at`, `updated_at`.

`invoice_lines`: `id`, `invoice_id`, `line_number`, `description`,
`quantity`, `unit_price`, `discount_percent`, `discount_amount`,
`vat_rate`, `income_account_id`, `line_total`.

`vat_rate` auto-suggests a default `income_account_id`, using the
finalized COA's existing VAT-treatment segmentation — standard-rated
goods → `4000`, standard-rated services → `4040`, zero-rated → `4010`,
exempt → `4020`. This is a suggested default, not a hardcoded mapping —
`income_account_id` is still stored explicitly per line and remains
manually overridable. *(Decision #4)*

Totals rule and locking behavior: same as §1.2's quotation rule,
applied to invoices. *(Decision #3, extended)*

### 1.4 `credit_notes` + `credit_note_lines`

`credit_notes`: same header shape as invoices, plus
`original_invoice_id` (required, not nullable — a credit note always
references the invoice it adjusts).

`credit_note_lines`: same shape as `invoice_lines`, plus
`original_invoice_line_id` (nullable).

- When set: `vat_rate` and `income_account_id` are derived from the
  referenced original line, not re-enterable — a supply's VAT treatment
  is fixed at the time it happened.
- When null: treated as a general adjustment, requiring a mandatory
  `reason` field.
- **DB-level constraint:** cumulative credited amount against any single
  `original_invoice_line_id` can never exceed that line's original
  `line_total` — enforced where `service_role` can't bypass it, matching
  Module 1.1.A decision #57's RPC-level (not just Nest-level) rejection
  of invalid opening-balance lines. *(Decision #5)*

---

## 2. Status lifecycles

### 2.1 Quotation status

`Draft → Sent → Viewed → (Accepted | Declined | Expired)`. `Accepted` is
the only status that leads to conversion (§4); converting locks the
quotation from further edits, via the same locking mechanism as §1.2.
`Expired` is a scheduled transition — see §8. *(Decision #6)*

### 2.2 Invoice status

`Draft → Issued → Sent → Viewed → (Partially Paid | Paid | Overdue |
Written Off | Void)`.

`Issued` is the transition where numbering (§3) and journal posting
(§7) both happen — deliberately separated from "customer has seen it"
(`Sent`/`Viewed`), which is a CRM concern with no ledger effect.

`Void` requires a mandatory `void_reason`. Once Issued, an invoice's
number is permanent — it cannot be deleted or renumbered around;
`Issued → Void` keeps the number visibly in the sequence with its
reason attached, matching Module 1.1.A's broader stance that a posted
financial document is corrected via a visible countermovement, not
erased (`prevent_posted_entry_deletion`; decision #56's `delete_blocked`
audit logging for attempted workarounds). Voiding an Issued invoice
automatically reverses its journal entry — a voided invoice is never
left as a dangling, uncorrected ledger entry.

`Overdue` is a scheduled transition — see §8. *(Decision #7)*

---

## 3. Numbering

Numbering is allocated on the `Draft → Issued` transition for **invoices**
(not at draft creation) — confirmed against FTA-compliance guidance and
matching Module 1.1.A's `entry_number` pattern (`allocate_next_entry_number`).
**Quotations** are different: `quotation_number` is allocated at row
creation (BEFORE INSERT trigger), not deferred to Sent or any later
transition — a quotation is a customer-facing document from first save.
*(Decision #16)*

Two RPCs, `allocate_next_quotation_number(company_id)` and
`allocate_next_invoice_number(company_id)`, follow the same
`pg_advisory_xact_lock` convention as Module 1.1.A §6, with new lock
namespaces `quo:` and `inv:` (`hashtext('quo:' || company_id)` /
`hashtext('inv:' || company_id)`), consistent with the existing `ob:`/
`ye:` pattern. Format: prefix + year + zero-padded sequence (e.g.
`QUO-2026-0001`). *(Decision #8)*

---

## 4. Quotation-to-invoice conversion

`convert_quotation_to_invoice(quotation_id, created_by)` copies header
and line data across, sets the two-way link
(`invoices.source_quotation_id` / `quotations.converted_to_invoice_id`),
and lands the new invoice in `Draft` status — never auto-Issued. A human
confirms before it becomes a real ledger transaction, consistent with
Module 1.1.A's general philosophy that posting is always a deliberate,
separately-triggered action. *(Decision #9)*

---

## 5. Payment terms

`payment_terms_type` enum: `net_7 | net_15 | net_30 | net_60 | custom |
cod`, plus a nullable `custom_days` integer for the `custom` case.
`due_date` is computed from `invoice_date + payment_terms` at Issue
time, server-derived rather than client-set. *(Decision #10)*

---

## 6. VAT calculation

### 6.1 Per-line VAT

Each line carries its own `vat_rate` — standard (5%), zero-rated,
exempt, or out-of-scope — reusing the same four-way classification
Module F will need, rather than inventing a C-specific scheme that F
would have to reconcile with later. The finalized COA already segments
revenue accounts by this exact classification (§1.3).

### 6.2 Tax invoice vs. simplified tax invoice

Per FTA Executive Regulation Article 59(5), invoice-type selection is
two-branch, not a single amount threshold:

1. **`customers.trn IS NULL`** (recipient not VAT-registered) →
   `simplified_tax_invoice`, regardless of amount.
2. **`customers.trn IS NOT NULL`** (recipient VAT-registered) →
   `tax_invoice` if `grand_total` (VAT-inclusive) exceeds AED 10,000,
   else `simplified_tax_invoice`.

A full `tax_invoice` is always a permissible override in either branch —
this is a floor, never a ceiling; the auto-selection logic must never
choose `simplified_tax_invoice` when branch 2's threshold requires a
full tax invoice. `invoice_type` is determined and locked at Issue time,
consistent with §2.2's locking behavior — it does not recompute if
anything changes afterward, since the invoice itself is fully locked at
that point. *(Decision #11)*

---

## 7. Ledger integration

On `Draft → Issued`, `create_invoice_journal_entry` (a new atomic RPC,
following the same pattern as Module 1.1.A's `insert_journal_entry_draft`
— not ad hoc multi-statement Nest logic) generates:

- **Debit** `1100 Accounts Receivable - Trade` for `grand_total`.
- **Credit** each line's `income_account_id` for that line's gross
  (pre-discount) VAT-exclusive amount.
- **Debit** `4060 Sales Discounts Given` for any line-level discount
  amount — discounts are never netted silently into the income credit;
  gross revenue and discounts given are both visible as separate lines.
- **Credit** `2200 VAT Payable (Output VAT)` for `vat_total`.

`1100` and `2200` are existing accounts in the finalized COA (both
`Control`, both active) — no new control accounts were needed.
*(Decision #12)*

`journal_entry_type` is extended with two new enum values,
`sales_invoice` and `credit_note` — a bare `manual`/`system`
classification would lose the same kind of audit-relevant information
Module 1.1.A decision #55 closed for self-approval events (was this
entry typed by a human, or generated by the invoicing engine). No new
column is needed on `journal_entries`; `invoices.journal_entry_id`
already provides the reverse lookup. *(Decision #13)*

Credit notes post via their own dedicated path, not a literal reuse of
`reverse_journal_entry` — a credit note can be partial (per §1.4's
line-level linkage), which that RPC's all-or-nothing design doesn't
support. *(Decision #14)*

---

## 8. Scheduled transitions

`quotations.Expired` (§2.1) and `invoices.Overdue` (§2.2) are
date-triggered status transitions. These register with the same
unattended scheduling infrastructure Module 1.1.A built for recurring
journal generation (decisions #62–#63) rather than introducing a second,
parallel scheduler — confirmed as a real, race-safe mechanism (per-key
`pg_advisory_xact_lock`, atomic check-and-transition, tested failure
recovery) before this module was finalized, not assumed to exist.
*(Decision #15)*

---

## 9. Explicitly deferred from this pass

PDF generation, WhatsApp share, Arabic/English bilingual toggle,
automated payment reminder emails, recurring invoice generation,
proforma-specific behavior beyond the `invoice_type` value already
reserved for it (§1.3), and invoice cloning. All presentation/delivery
concerns or independently-schedulable follow-ups that should wrap a
stable C1 core rather than be built alongside it, matching the same
reasoning `Module_1.1_Build_Order_Scope.md` applied to Module H's
deferred items.

---

## 10. Known open items

| Gap | Status | Detail |
|---|---|---|
| Product/service catalog default income-account mapping | **Deferred** | §1.3's VAT-rate suggestion is a per-line default; a catalog-driven default (a specific product always maps to a specific account) needs its own entity, not yet scoped |
| Discount CHECK constraint exact wording | **Closed** | §1.2 CHECK: percent XOR amount, or neither — implemented on `quotation_lines` |
| Invoice ledger posting at Issue (§7) | **Deferred — Batch 2** | C1-3 Issue allocates number, due_date, invoice_type only; `journal_entry_id` stays null; `create_invoice_journal_entry` not wired |
| Void auto-reversal of journal entry (§2.2) | **Deferred — Batch 2** | C1-3 records `void_reason` + status only; reversal call blocked until posting exists — no stub against null `journal_entry_id` |

---

## 11. Decision Log Index

| # | Date | Summary | Detail in |
|---|------|---------|-----------|
| 1 | 2026-08-30 | `customers` unique on `(company_id, trn)` where `trn` not null | §1.1 |
| 2 | 2026-08-30 | Discount stored as percent XOR amount, mutually exclusive CHECK | §1.2 |
| 3 | 2026-08-30 | Totals DB-computed while draft, locked on non-draft (**extended to invoices — C1-3**) | §1.2, §1.3 |
| 4 | 2026-08-30 | VAT rate auto-suggests income account per finalized COA's existing segmentation (**+ `is_service` on invoice_lines — C1-3**) | §1.3 |
| 5 | 2026-08-30 | Credit notes support line-level linkage; DB-enforced cumulative credit cap | §1.4 |
| 6 | 2026-08-30 | Quotation status lifecycle, `Expired` scheduled | §2.1 |
| 7 | 2026-08-30 | Invoice status lifecycle adds `Issued` and `Void`; void requires reason (**journal auto-reversal deferred Batch 2 — C1-3**) | §2.2 |
| 8 | 2026-08-30 | Numbering allocated at Issue (invoices), at INSERT (quotations #16); `quo:`/`inv:` locks (**C1-3 invoices**) | §3 |
| 9 | 2026-08-30 | Quotation-to-invoice conversion lands in Draft, never auto-Issued | §4 |
| 10 | 2026-08-30 | Payment terms enum; `due_date` server-derived at Issue (**C1-3**) | §5 |
| 11 | 2026-08-30 | Tax invoice vs. simplified: two-branch (TRN + AED 10,000 VAT-inclusive threshold), FTA Art. 59(5) (**C1-3**) | §6.2 |
| 12 | 2026-08-30 | Invoice posting: AR (1100) / income / discounts (4060) / VAT Payable (2200) (**deferred Batch 2 — C1-3 scope boundary**) | §7 |
| 13 | 2026-08-30 | `journal_entry_type` extended with `sales_invoice`, `credit_note` | §7 |
| 14 | 2026-08-30 | Credit notes use a dedicated posting path, not `reverse_journal_entry` | §7 |
| 15 | 2026-08-30 | Expired/Overdue reuse Module 1.1.A's #62–#63 scheduler, confirmed live and race-safe before adoption | §8 |
| 16 | 2026-08-31 | `quotation_number` allocated at quotation INSERT (BEFORE INSERT → `allocate_next_quotation_number` / `quo:` lock), not deferred to Sent or later — distinct from invoice numbering at Issue (#8) | §3, §1.2 |
| 17 | 2026-08-31 | `customers.trn` immutable after create — set on POST only; wrong TRN → deactivate + new customer; avoids duplicate-legal-entity ambiguity (#1) and invoice-type drift (§6.2) | §1.1 |
