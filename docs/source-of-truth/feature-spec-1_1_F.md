# Module 1.1.F — UAE VAT (5%) Compliance Engine
## Feature Specification (Source of Truth Once Ratified)

Part of Module 1.1 · AI-Based Accounting Foundation, inFINity Phase 1 (MVP).
This is the scope document for Module 1.1.F only — do not infer scope from
Module 1.1.A/C/D/E/H1 or Module G.

**Status: ✅ Built 2026-09-16.** This spec follows the same numbered-decision
discipline `feature-spec.md` (A), `feature-spec-1_1_C.md` (C),
`feature-spec-1_1_D.md` (D), and `feature-spec-1_1_E.md` (E) used:
decisions are numbered (F-1…); once written, nothing is silently edited —
append F-45+. F-33 / F-36 / F-37 are closed by F-38…F-41. Residual before
export-mapping: tax-advisor confirm of the AED 10,000 VD amount threshold
(F-39) and an EmaraTax screenshot for Box 2 + the CAS box (F-42). Every
GL account number below is
resolved against `Chart of Accounts - inFINity.xlsx` (via
`seed_finalized_coa_demo_company_0002.sql`) and `schema.sql`. Every FTA
rate, due date, and retention figure is resolved against
`Accounting Rules - inFINity.pdf` Part 2.2 / 2.3 / 2.5 / 3.14 / 5.
Open flags from the first draft are closed in F-18…F-32, F-34, F-35;
owner answers of 2026-09-15 are F-38…F-44.

**Build Order context:** per `Module_1.1_Build_Order_Scope.md` §6, F is
sequenced sixth — after A (Module 0), C (Module 2), E (Module 4), and
H-core (Module 1) — "VAT 201 auto-calculation needs output tax data
(from C's invoices), input tax data (from E's bills), and reconciles to
the general ledger via the reporting core (Module 1)." The Build Order
also flags F as "the highest-compliance-risk module in the list" and
recommends an audit-sweep pass before sign-off, not just a standard
test suite (§6) — this spec treats that as a build-status requirement,
not a suggestion (see §8).

**Dependencies, verified directly against `schema.sql`:** Module 0 (A) —
`companies` (`trn`, `is_free_zone_entity`), `company_settings`,
`accounts`, `journal_entries` / `journal_lines`,
`is_ledger_truth_status()`, `reverse_journal_entry`,
`journal_approval_threshold`, the `hashtext('<ns>:' || id)` advisory-lock
convention, no-delete/reversal-only discipline. Module 2 (C) —
`invoices` / `invoice_lines.vat_rate numeric(5,2) not null`,
`credit_note_lines.vat_rate`, `quotation_lines.vat_rate`,
`invoice_number` allocated at Issue (`INV-YYYY-NNNN`), posting to `2200`.
Module 3 (D) — `write_offs.vat_relief_eligible` /
`vat_relief_flagged_at` / `debtor_notified_at`; `mark_vat_relief_eligible`
clocks 6 months from `invoices.invoice_date` (not write-off date) plus
non-null `debtor_notified_at` (D-8 / §4.5b). Module 4 (E) — `bills` /
`bill_lines.vat_rate numeric(5,2) not null check (0–100)`, Issue posting
to `1400`, reserved-unused `1410`/`2210`/`5800`/`5580` (E-2). Module 1
(H-core) — `v_trial_balance`, `get_general_ledger`, for VAT-to-GL
reconciliation (§4.17).

**Confirmed directly against the finalized COA** (same file E-2 used):

| Purpose | Account | Basis |
|---|---|---|
| Input VAT (recoverable) | `1400` VAT Receivable (Input VAT) | `[Control][Recoverable Input VAT]`; E-2; pair of `2200` |
| Reverse-charge input VAT | `1410` VAT Receivable - Reverse Charge (Input Leg) | `[Detail][RCM Input]`; E-2 reserved for F |
| VAT receivable — bad debt relief | `1415` VAT Receivable, Bad Debt Relief | F-41 — additive COA at F build (slot free between `1410` and `1420`); not `1400` |
| VAT refund receivable | `1420` VAT Refund Receivable from FTA | `[Detail] Approved refund claim pending disbursement` — F-20 |
| Output VAT / net payable | `2200` VAT Payable (Output VAT) | `[Control][Output VAT 5%] FTA VAT Law - net payable per return` — F-20; no separate FTA-payable account exists |
| Reverse-charge output VAT | `2210` VAT Payable - Reverse Charge (Output Leg) | `[Detail][RCM Output]`; E-2 reserved for F |
| VAT penalty accrual | `2230` VAT Penalty Accrual | `[Detail] Late filing/payment/voluntary disclosure penalties`; seed `is_active = false` — activate if F-28 posts |
| Non-recoverable input VAT | `5800` Non-Recoverable Input VAT Expense | `[Detail][Blocked Input VAT]`; E-2 reserved for F |
| Blocked entertainment (expense + VAT note) | `5580` Client Entertainment (Non-Deductible for CT) | `[Detail][Blocked Input VAT]`; E-2 reserved for F |
| Standard-rated sales | `4000` / `4040` | C #4; `vat_rate = 5` suggestion |
| Zero-rated sales | `4010` Sales Revenue - Zero Rated (Exports) | `[Detail][Zero-Rated 0%]`; C #4 `vat_rate = 0` |
| Exempt sales | `4020` Sales Revenue - VAT Exempt | `[Detail][Exempt]`; C #4 non-5 non-0 |
| Designated-zone sales | `4030` Sales Revenue - Designated Zone | `[Detail][Designated Zone]`; seed `is_active = false`; Rules §2.2 — F-19 |
| Bank/Cash default | `1020` | D-6; VAT payment to FTA (F-30) |
| Bad debt expense (ECL) | `5640` | D-8 — write-off / provision; not the relief credit |
| Bad debt recovery (VAT relief) | `5641` Bad Debt Recovery | F-41 — additive contra-expense at F build (slot free after `5640`); credit side of relief JE |

**Accounting Rules sourced here** (PDF, source of truth #1):

- §2.2 — 5% standard; zero-rated vs exempt vs designated zone; blocked
  input (entertainment, personal vehicles, certain employee benefits);
  filing generally quarterly (some monthly) via EmaraTax, **due by the
  28th of the month following the tax period**; RCM on imports of
  goods/services; refunds carried forward or claimed, input tax
  recoverable within 5 years; tax-invoice field rules (C already owns
  Issue-time invoice shape).
- §2.3 — penalty framework (warn, do not auto-file).
- §2.5 — VAT records 5 years; capital-asset records 10 years; real
  estate 15 years; dual-relevant default 7 years.
- §3.14 — Output/Input/Net/RCM formulas.
- §1.3 — once a period is filed (e.g. VAT return), prevent backdated
  postings unless a prior-period adjustment workflow.
- Part 5.1 / 5.2 — versioned tax config; never auto-submit a VAT return.

**Not in the PDF, closed by owner 2026-09-15 rather than invented:**
Capital Assets Scheme AED 5,000,000 / 5-yr vs 10-yr (F-40); VAT 201
boxes 1 and 3–14 from filing guides (F-42 — Box 2 and CAS box still
screenshot-gated); bad-debt relief GL `Dr 1415 Cr 5641` (F-41). Partial
exemption de-minimis stays deferred (F-35). AED 10,000 VD amount
threshold is versioned and **awaiting tax-advisor confirmation** (F-39)
because sources conflict on whether it still exists.

---

## 0. Owner decisions (2026-09-15) — closed except two residuals

F-33 / F-36 / F-37 are answered below. Full text is F-38…F-44. Do not
silently edit those entries.

| # | Answer | Closes |
|---|---|---|
| Post-filing lock | One `VAT_PERIOD_FILED` rule: VAT-relevant accounts **or** invoice/CN/bill Issue. Not a per-type whitelist. Two correction paths (next-period vs Form 211). Emirate-mismatch always needs VD. | F-33 → F-38, F-39, F-43 |
| Capital Assets Scheme | AED 5,000,000 excl. VAT; 10 years buildings/RE; 5 years other; hide below threshold; cumulative per project for staged payments. | F-36 → F-40 |
| Bad-debt relief JE | Reject no-JE and `Cr 1400`. `Dr 1415 Cr 5641`. | F-37 → F-41 |
| VAT 201 boxes | Seed 1, 3–14 from the owner table; Box 1 by Emirate; Box 2 and CAS box wait for an EmaraTax screenshot before export. | F-27 → F-42 |

### Residual — do not hard-code as immutable law

1. **AED 10,000 VD amount threshold (F-39).** Majority of sources citing
   Tax Procedures Law Art. 10 / Cabinet Decision 74/2023 still describe
   it; some 2023-era commentary says it was removed. Seed
   `vd_amount_threshold = 10000` on `vat_tax_rule_versions`. Tax advisor
   must confirm before go-live. Changing the seed must not require a
   code change (Part 5.1).
2. **Box 2 label and the Capital Assets Scheme box (F-42).** Not
   independently confirmed against the FTA form. Calculate/review ship
   on internal groups; export/file stay blocked for those groups until
   an EmaraTax screenshot fills `fta_box_code`.
3. **Emirate-mismatch VD (F-39 / F-43)** is a non-obvious trigger
   (FTA Decision No. 8 of 2024): a standard-rated supply in the wrong
   Emirate box needs Form 211 even when net tax payable is unchanged.
   Built; flag to the company's tax advisor that this is in scope.

---

## 1. Scope boundary

Source deliverables for this pass, each mapped to a section (as given
in the module request, 2026-09-14):

| # | Deliverable | Section |
|---|---|---|
| 1 | VAT rate per transaction: standard/zero-rated/exempt/out-of-scope | §4.1 |
| 2 | Reverse charge mechanism (imported services) | §4.2 |
| 3 | Partial exemption apportionment | §4.3 |
| 4 | Capital goods scheme (5-yr / 10-yr adjustment tracking) | §4.4 |
| 5 | Bad debt relief (6-month FTA rule) | §4.5 |
| 6 | VAT 201 return auto-calculator | §4.6 |
| 7 | Box-by-box breakdown | §4.6 |
| 8 | Drill-down per box | §4.7 |
| 9 | VAT 201 review and approval workflow | §4.8 |
| 10 | Export to FTA portal | §4.9 |
| 11 | Direct FTA e-filing API (architecture only) | §4.10 |
| 12 | VAT payment due date → payment reminder module | §4.11 |
| 13 | Voluntary disclosure (VAT 211) | §4.12 |
| 14 | VAT refund claim | §4.13 |
| 15 | 5-year immutable record | §4.14 |
| 16 | FTA audit pack | §4.15 |
| 17 | Sequential invoice register with gap detection | §4.16 |
| 18 | VAT reconciliation (201 → GL) | §4.17 |

Plus items required by Accounting Rules that the eighteen deliverables
did not name, added the same way E added GRNI (Rules §1.5) rather than
silently dropped:

| Extra | Section | Why in this pass |
|---|---|---|
| Versioned VAT rate table | §3.9 / F-23 | Rules §2.1 / Part 5.1 — tax logic must update without redeploying core code |
| Penalty-exposure warning | §4.18 / F-28 | Rules §2.3 — compute and warn; do not auto-post |
| VAT payment to FTA | §4.19 / F-30 | F-11 stores the due date; settling `2200`/`1420` vs `1020` is the cash event |
| Return settlement JE | §4.6 / F-31 | COA `2200` is "net payable per return"; `1420` is claimed refunds only |
| Registration-threshold readout | §5.2 / F-32 | Rules Part 5.4 — rolling 12-month taxable supplies vs AED 375,000 / 187,500 |
| Post-filing VAT lock + two-tier correction | §4.14 / §4.20 / F-38 / F-39 | Rules §1.3; owner 2026-09-15 |
| Emirate on standard-rated supplies | §4.1 / F-43 | VAT 201 Box 1 is by Emirate |
| CAS AED 5m gate + project cumulative | §4.4 / F-40 | Owner 2026-09-15 |
| `1415` / `5641` COA extension | §4.5 / F-41 | Same discipline as E-23 `1350` |

**Explicitly out of scope for this pass** (see §7 for detail): actual
submission to the FTA portal or FTA API (export/architecture only);
actual filing of a VAT 211 or a refund claim (preparation only);
e-invoicing / Peppol / ASP (Rules §2.6 — C/EIS, not this module);
Corporate Tax and free-zone qualifying-income classification (Module G);
PDF/XLSX rendering mechanics generally (Build Order §8, H-remainder);
a live payment-reminder/notification engine; multi-currency VAT;
company-settings admin API/UI (D-13/E-26); sales-side reverse charge;
partial-exemption de-minimis.

**Depends on:** Module 0 (A), Module 2 (C), Module 4 (E), Module 1
(H-core) — per Build Order §6, all four. Module 3 (D) for bad-debt
relief only.

---

## 2. Decision log

Numbered F-1 onward. F-1…F-17 are the first-draft entries. F-18+ close
the `[OPEN]` markers from that draft against `schema.sql`, the COA
seed, the D/E specs, and the Accounting Rules PDF. Do not silently
rewrite F-1…F-17; banners point at the closing entry.

### F-1 — VAT category is a new field, separate from the existing numeric `vat_rate`

**Closed by F-18 / F-19 (2026-09-14):** `invoice_lines.vat_rate` is
`numeric(5,2) not null` with **no** 0–100 CHECK (schema.sql
`invoice_lines`); `bill_lines.vat_rate` is `numeric(5,2) not null
check (vat_rate >= 0 and vat_rate <= 100)`; `quotation_lines.vat_rate`
and `credit_note_lines.vat_rate` match the same numeric shape. C §6.1
already names the four-way classification but only stores the number.
`vat_category` is also added to `quotation_lines` and
`credit_note_lines`. Fifth enum value `designated_zone` added (F-19).

**Decision:** add `vat_category` — an enum of `standard_rated` /
`zero_rated` / `exempt` / `out_of_scope` — to `invoice_lines` and
`bill_lines`, additive alongside C's existing per-line `vat_rate`
(referenced in E's Dependencies section: *"per-line `vat_rate`"*), not
replacing it. `vat_rate` is required whenever `vat_category =
standard_rated` (should compute to 5%); for the other three categories
`vat_rate` is `0`, and the FTA-facing distinction lives entirely in
`vat_category`.

**Why a new field, not derived from rate:** `0%` is not one fact, it's
three different facts with three different consequences — zero-rated
supplies still count toward taxable turnover and permit full input
recovery, exempt supplies do neither, and out-of-scope supplies (e.g.
outside UAE) sit outside the VAT system entirely. A VAT 201 box
calculator that only reads `vat_rate` cannot tell these apart, and
neither can partial-exemption apportionment (§4.3), which needs the
exempt/taxable split specifically. Storing the category explicitly at
the line — the same place `vat_rate` already lives — means Issue-time
validation can require it, the same way C requires `income_account_id`
at Issue and E requires `account_id` on bill lines at Issue.

**`[OPEN — NEEDS SCHEMA VERIFICATION]`:** the exact current column name,
type, and nullability of `vat_rate` on `invoice_lines`/`bill_lines`
were not independently re-read from `schema.sql` in this pass — this
decision assumes the shape implied by E's Dependencies section. Confirm
before implementation.

### F-2 — GL accounts: reuse E's reserved accounts; new accounts are flagged, not invented

**Closed by F-20 (2026-09-14):** `1420` already exists (refund
receivable). `2200`'s COA description is already "net payable per
return" — no new FTA-payable account. No capital-goods adjustment
account exists; CGS posts to `1400`/`2200`/`5800` (F-20). `2230`
exists for penalties (inactive in seed).

**Decision:** F posts to and reconciles against the six accounts E
already named as F's (see header table): `1400`/`2200` for standard
input/output VAT, `1410`/`2210` for reverse-charge self-assessment,
`5800`/`5580` for non-recoverable and blocked-entertainment input VAT.
F does **not** invent numbers for the accounts it additionally needs —
a net **VAT Payable to FTA** control account for the amount due after
netting `2200 − 1400 (± 1410/2210)` at period close, and a **VAT Refund
Receivable** account for approved refund claims (§4.13) — those are
`[OPEN — NEEDS COA VERIFICATION]`. If a suitable account already exists
in the finalized COA under a different number, use it (same discipline
as E-2's residual-bucket reasoning for `1320`/`1350`); only if none
exists does this become a COA-extension decision, the same category of
decision E-23 was for `1350`.

**Why flag rather than guess:** E-2's entire discipline was "no number
is invented" — reading straight from the seed file/xlsx. This drafting
pass does not have that file. Posting VAT entries against a guessed
account number would be a worse failure mode than leaving the gap
explicit, since it would silently misstate a real regulatory filing.

### F-3 — Reverse charge posts inside the same bill-Issue journal entry, not a new type

**Decision:** a bill line flagged `vat_treatment = reverse_charge`
(imported services) causes E's existing bill-Issue posting RPC (E-12:
bill Issue posts a `purchase_invoice` journal entry directly, no
separate approval gate below the AED 50,000 threshold per E-28) to add
two extra, self-balancing legs to that same journal entry: a debit to
`1410` (input side, recoverable) and a credit to `2210` (output side,
self-assessed liability) for the VAT amount that would have applied had
the supplier charged it. No new `journal_entry_type` value — it stays
`purchase_invoice` (E-15), just with more lines.

**Why fold it into the existing JE rather than a new posting path:**
E-12's own reasoning was "a supplier bill... is the same category of
document-engine posting as a sales invoice... not a discretionary loss" —
reverse charge is still triggered by, and dated to, the same bill-Issue
event; giving it a second RPC and a second `journal_entry_type` would
be exactly the kind of parallel path E-12 and E-13 both declined to
create for AP generally. The two legs net to zero cash and zero P&L —
they exist purely to make the self-assessed VAT visible on both sides
of the VAT 201 return (Box 3 output-side reverse charge, Box 10 or
equivalent input-side recovery — see F-6's box-mapping note below).

**Amended by F-25:** the purchase-side flag lives on
`bill_lines.vat_input_treatment = 'reverse_charge'`, not a separate
overlapping `vat_treatment` column. RCM VAT amount =
round(line net × current standard rate from `vat_tax_rule_versions`, 2)
per Rules §3.14. `bill_lines.vat_rate` stays `0` and `vat_total` on
the header does **not** include RCM (the supplier did not charge it);
the extra `1410`/`2210` legs are computed at Issue, not from
`bills.vat_total`. Sales-side RCM is out of scope (F-34 / §7).

### F-4 — Partial exemption apportionment: standard method only, explicit period-end run

**De-minimis remains deferred (F-35).** `is_mixed_use` is folded into
`vat_input_treatment = 'mixed_use'` (F-25).

**Decision:** `bill_lines`/purchase transactions gain an `is_mixed_use`
flag for input VAT that cannot be directly attributed to either fully
taxable or fully exempt output. A period-end `calculate_partial_exemption(period)`
RPC computes `recoverable_pct = taxable_output / (taxable_output +
exempt_output)` for the period (the FTA's default "standard method";
no special/input-based method in this pass) from `vat_category`-tagged
invoice lines (F-1), writes the result and its inputs to
`vat_apportionment_calculations`, and applies that percentage to
`is_mixed_use` input VAT lines, moving the non-recoverable portion from
`1400` to `5800` (already reserved for exactly this, per E-2).

**Why an explicit RPC, not a cron:** matches the project's established
convention for period-sensitive calculations — E-21/E-24 built GRNI
accrual as an explicit RPC specifically to avoid an unattended cron
touching the ledger silently. Apportionment is the same category of
decision (it changes how much input VAT is recoverable) and gets the
same treatment.

**`[OPEN]`:** whether the FTA's de-minimis rule (exempt input VAT under
a small annual threshold and under 5% of total input VAT is fully
recoverable without apportionment) should be modeled in this pass is
not resolved here — flagged for a follow-up decision (F-N+) rather than
silently assumed either way.

### F-5 — Capital goods scheme: per-asset adjustment period, not a single hardcoded rule

**Closed by F-40 (2026-09-15):** AED 5,000,000 excl. VAT; 10 years
buildings/real estate; 5 years other qualifying; hide below threshold;
cumulative spend per project. `adjustment_period_years` is
system-defaulted from category, not free-text.

**Decision:** `capital_goods_items` (one row per qualifying capital
asset — a large fixed asset or a piece of real estate) stores the
asset's initial capital value, initial recovery percentage, and an
`adjustment_period_years` value. A `capital_goods_adjustments` table
holds one row per fiscal year of that asset's adjustment window, each
row recording that year's actual taxable-use percentage versus the
initial recovery percentage, the resulting VAT adjustment amount, and
the journal entry it posts once an explicit annual
`run_capital_goods_adjustment(item_id, fiscal_year)` RPC is invoked
(same explicit-RPC pattern as F-4 and E-21/E-24 — never a silent cron).

**Why per-asset rather than one global 5-year or one global 10-year
rule:** the module request states both "5-year and 10-year periods"
without specifying which asset class gets which — rather than guess
that split (e.g. real estate at 10 years, other capital goods at 5),
this spec makes `adjustment_period_years` a required field set per
asset at creation, so an accountant enters the correct period for that
specific asset instead of the system enforcing a possibly-wrong default.

**`[OPEN — NEEDS FTA RULE VERIFICATION]`:** the exact AED value
threshold above which an asset qualifies for the Capital Assets Scheme,
and which asset classes take which adjustment period, are FTA
executive-regulation facts this drafting pass could not verify against
an Accounting Rules source document (none was available). Do not build
the threshold as a hardcoded gate until that verification happens;
until then, `capital_goods_items` creation is a manual accountant
judgment call, not a system-enforced eligibility check.

### F-6 — Bad debt relief builds on D's existing flag; does not re-derive eligibility

**Closed by F-18 (2026-09-14):** D-8 / D §4.5b /
`mark_vat_relief_eligible` clocks 6 months from
`invoices.invoice_date` (date of supply), **and** requires
`write_offs.debtor_notified_at is not null`. Not the write-off date.
F still does not re-derive that clock. Relief JE is F-41
(`Dr 1415 Cr 5641`), not F-37 A/B/C.

**Decision:** `vat_bad_debt_relief_claims` — one row per `write_offs`
row where `vat_relief_eligible = true` (D's flag, per Build Order §2/§3)
— tracks the elapsed-time check against the FTA's 6-month rule, claim
status (`pending_eligible → claimed → (reversed if later recovered)`),
and the linked VAT 201 box it feeds. F reads D's flag and D's
underlying write-off date; it does not re-implement eligibility logic D
already owns.

**`[OPEN — NEEDS D-SPEC VERIFICATION]`:** which date D's
`vat_relief_eligible` flag clocks its 6 months from — write-off date or
`debtor_notified_at` (both mentioned in the Build Order's description of
D) — was not independently confirmed against `feature-spec-1_1_D.md`
itself in this pass (not one of the two source documents available).
Confirm against D's own decision log before wiring the elapsed-time
check.

**Why build on D's flag rather than duplicate it:** Build Order §2/§3
is explicit that D intentionally stopped at flagging eligibility and
left filing/reclaim to F — re-deriving eligibility here would create
two sources of truth for the same 6-month clock.

### F-7 — VAT 201 return: one row per tax period, calculated by an explicit RPC, boxes keep transaction-level detail

**Amended by F-42 (2026-09-15):** owner supplied boxes 1 and 3–14 from
filing guides. Box 2 and the CAS adjustment box stay `fta_box_code`
null until an EmaraTax screenshot. Box 1 is by Emirate (F-43).

**Decision:** `vat_return_periods` (period start/end, status,
computed totals) plus `vat_return_line_items` (one row per FTA box —
standard-rated supplies, zero-rated, exempt, reverse-charge/imports,
standard-rated purchases, etc.) populated by a `calculate_vat_return(period)`
RPC that reads `vat_category`-tagged invoice/bill lines (F-1) and the
GL accounts in F-2/E-2. Each `vat_return_line_items` row keeps
references to every underlying `journal_lines`/invoice-line/bill-line
row that fed it — not just the aggregate total — enabling drill-down
(deliverable #8) without a second query layer.

**Why keep transaction-level detail per box, not just a total:** same
reasoning E-9 gave for persisting three-way-match results instead of a
live-only query — "the discrepancy is a judgment... the approver needs
to see *why*." A VAT 201 reviewer needs the identical thing: not just
"Box 1 = AED 42,300" but every invoice line that summed to it, since
that's what the review-and-approval workflow (deliverable #9, §4.8)
actually reviews.

### F-8 — Review and approval: reuse existing Owner/Accountant guards, no new role model

**Decision:** `vat_return_periods.status`:
`draft → calculated → under_review → approved → filed` (+ `superseded`
once a voluntary disclosure — F-11 — corrects a filed period). An
Accountant-role user moves `calculated → under_review` (review); an
Owner-role user moves `under_review → approved` (approval before
filing) — the existing Nest Owner/Accountant guards, not a new
role/permission construct, the same way E-12 kept bill-Issue approval
on the existing guards rather than inventing an AP-specific one.

**Amended by F-24 / Rules Part 5.2:** `filed` is Owner-only and records
that a human has taken the package; the stub adapter never actually
submits. Journal approve/reject on F's own JEs still uses Owner/Manager
per A #41 (threshold path), not Accountant.

### F-9 — Export to FTA portal: F owns the data package; general export mechanics stay H-remainder's job

**Decision:** F is responsible for the FTA-specific **shape** of the
export (which boxes, in which order, in whatever layout the FTA portal
expects for manual entry) because that is compliance logic specific to
this module. F is **not** responsible for building generic
file-generation infrastructure — Build Order §8 already scopes
PDF/XLSX/CSV export mechanics to H-remainder. If H-remainder's export
layer exists by the time F is built, F's export endpoint calls into it;
if not, F ships a minimal, single-purpose CSV/XLSX writer scoped to
just this one FTA layout rather than blocking on H-remainder or
building a second general-purpose export system.

**Amended by F-27:** export is rejected (`VAT_BOX_MAP_INCOMPLETE`) until
`vat_return_box_definitions` has a non-null `fta_box_code` for every
internal group that has a non-zero amount.

### F-10 — Direct FTA e-filing API: adapter interface with a stub implementation, not a live integration

**Decision:** an `fta_filing_adapter` interface (`submit(return_id) →
result`) is built now, with the only implementation in this pass being
a stub that returns "not yet available" (gated by a
`company_settings.fta_api_enabled` flag, default `false`). No FTA
credentials, no live HTTP integration, no retry/error-handling logic
for a real FTA response — those all depend on an FTA API surface this
spec cannot see. The point of building the interface now is exactly
what the module request says: *"architecture ready, activated when FTA
API opens to third parties."* Swapping in a real implementation later
should not require changing `vat_return_periods`' schema or the
review/approval workflow (F-8) — only the adapter's implementation.

**Confirmed against Rules Part 5.2:** the software must never
auto-submit a VAT return. Stub + Owner `filed` stamp is the whole
filing path in this pass. No settings write API (D-13/E-26) —
`fta_api_enabled` is seed/SQL only.

### F-11 — VAT payment due date: written to a column, not to a reminder engine that doesn't exist

**Closed by F-21 (2026-09-14):** Rules §2.2 — due **by the 28th of the
month following the tax period** (calendar 28th, not "28 days after
period-end").

**Decision:** `vat_return_periods.payment_due_date` is computed and
stored on the return once calculated (F-7). F exposes it via API/report
for whatever consumes it. F does **not** build a
notification/reminder-sending engine — no such module exists anywhere
in the project yet (D deferred AR dunning/reminders the same way,
per Build Order §3).

**`[OPEN — NEEDS FTA RULE VERIFICATION]`:** the exact statutory days-
after-period-end for VAT payment due date (commonly cited as 28 days,
but not independently verified against an Accounting Rules source in
this pass) is flagged, not hardcoded with false confidence.

**Why write the column and stop there, rather than build a reminder
system to receive it:** the module request says "auto-imported to
payment reminder module" — that module doesn't exist. Building a
reminder engine as a side effect of F would be scope creep into a
feature no other module has built yet; the column is F's actual
deliverable, and a future reminders module reads it, the same way
D's aging report reads `bills.due_date` rather than D building the
reminder itself.

### F-12 — Voluntary disclosure (VAT 211): template preparation, not submission

**Amended by F-39 (2026-09-15):** two-tier path. Amount ≤ versioned
`vd_amount_threshold` (seeded AED 10,000, advisor-confirm) → next-period
correction, no Form 211. Amount above, **or** Emirate-mismatch even at
zero net-tax delta → this VD workflow, due 20 business days from
discovery (`add_business_days`, D-10). Still prepare-don't-submit.

**Decision:** `vat_voluntary_disclosures` — linked to the originally
filed `vat_return_periods` row being corrected, storing the error
description, corrected box figures, and the delta — generates a
completed VAT 211 template for download/print. It does not submit
anything to the FTA (same "prepare, don't file" boundary as F-10 for
e-filing generally). Requires Owner approval, reusing F-8's guard.

**Amended by F-28:** Rules §2.3 voluntary-disclosure penalty (1% per
month on the tax difference) is **warned** on the disclosure row, not
auto-posted.

### F-13 — VAT refund claim: a flagged status, not an auto-filed claim

**Superseded for eligibility cadence by F-22 (2026-09-14):** Rules §2.2
does not specify N consecutive periods. A period is `eligible` when
Net VAT (Rules §3.14) is negative. Default is carry-forward (leave
debit on `1400`). `claimed` is Owner-initiated and is the only event
that transfers the remainder to `1420`. Input tax generally recoverable
within 5 years (Rules §2.2).

**Decision:** `vat_return_periods` gains a `refund_claim_status`
(`none / eligible / claimed`). A period is marked `eligible` when input
tax has exceeded output tax for `N` consecutive periods (`N` is a
company-configurable setting, default `[OPEN — NEEDS FTA RULE
VERIFICATION]`, since the FTA's own refund-eligibility cadence was not
available to verify in this pass). Marking `claimed` is an Owner-
initiated action, never automatic — the system surfaces the
opportunity, an accountant/owner still decides to file.

### F-14 — 5-year immutable record: inherited from Module 0, not re-invented

**Decision:** F adds no new immutability mechanism. Module 0's
no-delete/reversal-only discipline already applies to every
`journal_entries` row F's postings create (F-3, F-4, F-5). The one
F-specific addition: once a `vat_return_periods` row reaches `filed`,
it becomes append-only the same way — corrections happen exclusively
via a new `vat_voluntary_disclosures` row (F-12) layered on top, never
by editing a filed return in place. There is also, project-wide, no
admin write/delete API at all (D-13/E-26 boundary) — so hard deletion
of VAT records was never possible to begin with; F doesn't need to newly
enforce something that's already structurally true by omission.

**Retention (Rules §2.5), not a new delete job:** VAT-only records
5 years from end of tax period; capital-asset records 10 years; real
estate 15 years; dual-relevant default 7 years. F stores
`retention_until` on `vat_return_periods` using the **longest**
applicable period for that return's contents (Part 5.7). No purge job
in this pass. Interaction with A's hard-close stub is F-33 (user-owned).

### F-15 — FTA audit pack: F aggregates, H-remainder renders

**Decision:** an `assemble_audit_pack(period)` RPC in F collects
references to everything a period's audit pack needs — the filed VAT
201, its box-level line items (F-7), the underlying invoices/bills/JEs,
and the sequential invoice register (F-16) for that period — into one
response. Actual PDF/bundle rendering depends on F-9/Build-Order-§8's
export layer, the same split C used for invoice PDF (deferred) and D
used for statement PDF (deferred).

### F-16 — Sequential invoice register with gap detection: scoped to C's `invoice_number`, not E's `bill_number`

**Decision:** the register is a view/report over C's FTA tax-invoice
sequence (`invoice_number`, format confirmed by E's Dependencies
section as issued at Issue-time) per company per year, flagging any
numeric-suffix gap. Void invoices are reconciled as accounted-for
(a number that was allocated and then voided, visible in the register,
not a silent hole) versus a true missing-number gap. This is explicitly
named as F's job in the Build Order (§2: *"FTA sequential numbering gap
detection / immutable audit register | Post-C1 / F"*).

**Why not E's `bill_number` too:** a bill's sequential number is
inFINity's own internal reference for a document a *supplier* issued
to us — the FTA's sequential-numbering requirement is about the tax
invoices *we* issue, which is C's `invoice_number`, not E's
`bill_number`. Extending gap detection to bills would be checking a
number that has no FTA compliance meaning.

**Confirmed against schema:** `allocate_next_invoice_number` uses lock
`inv:`, format `INV-YYYY-NNNN`, unique `(company_id, invoice_number)
where invoice_number is not null`. Credit notes (`CRN-YYYY-NNNN`) are
**not** the tax-invoice sequence; they appear in VAT 201 as adjustments
(F-7) but not in this gap register. Draft invoices have null
`invoice_number` and are excluded.

### F-17 — VAT reconciliation: computed boxes vs actual GL balances, explicit variance report

**Decision:** `reconcile_vat_return(period)` RPC sums each VAT-return
box's computed figure (F-7) against the period's actual GL movement in
`1400`/`2200`/`1410`/`2210`/`5800`/`5580` (via H-core's
`v_trial_balance`/general-ledger report), and flags any variance rather
than silently trusting the box calculation. This is the same "figures
must tie to the ledger" instinct D's aged-payables/receivables reports
already assume implicitly for their control accounts — made explicit
here because it is a named deliverable, and because a VAT return that
doesn't reconcile to the books is exactly the kind of gap an FTA audit
would catch.

**Amended by F-20:** reconciliation also includes `1420` once a refund
has been claimed, and `2230` if a penalty JE was posted.

### F-18 — Grounding pass against schema.sql, D spec, and E spec (2026-09-14)

**Decision:** the first draft's schema/D verification OPENs are closed
as follows. No number, column, or clock was invented.

| Draft OPEN | Finding | Source |
|---|---|---|
| F-1 `vat_rate` shape | `invoice_lines.vat_rate numeric(5,2) not null` (no 0–100 CHECK). `bill_lines.vat_rate numeric(5,2) not null check (0–100)`. Same numeric type on `quotation_lines` (with CHECK) and `credit_note_lines` (no CHECK). | `schema.sql` |
| F-1 C four-way | C §6.1 already names standard/zero-rated/exempt/out-of-scope but stores only the number. Income suggestion: `vat_rate = 5` → `4000`/`4040`; `= 0` → `4010`; else → `4020`. `0` cannot tell zero-rated from exempt/out-of-scope — that is why F-1 stands. | C #4, `suggest_invoice_line_income_account` |
| F-6 6-month clock | `mark_vat_relief_eligible`: `invoices.invoice_date <= as_of - 6 months` **and** `debtor_notified_at is not null`. D-8: date of supply is `invoices.invoice_date`, not write-off date. | D-8, D §4.5b, `schema.sql` |
| F-10 settings | `company_settings` has no `fta_api_enabled` today. Additive column, seed `false`, no write API. | D-13 / E-26 |
| E reserved accounts | `1410`/`2210`/`5800`/`5580` exist in the COA seed and are unused by E posting RPCs. | E-2, seed |

C's Issue RPCs and E's `create_bill_journal_entry` / `issue_bill` gain
F-owned validations and extra legs in this module's build; that is an
additive change to those RPCs, not a silent rewrite of C #12 / E-12 /
E-17.

### F-19 — `vat_category` on quotations and credit notes; fifth value `designated_zone`

**Decision:** add `vat_category` (nullable until Issue/convert) to
`quotation_lines`, `invoice_lines`, `credit_note_lines`, and
`bill_lines`. Enum:

```
standard_rated | zero_rated | exempt | out_of_scope | designated_zone
```

`designated_zone` is required by Rules §2.2 and COA `4030` (currently
`is_active = false` in the seed — F does not silently activate it;
income-account suggestion may use `4030` when the account is active).
Rules §2.2: designated-zone goods (not services) are flagged for
manual/rules-based review — they are **not** auto-mapped to an FTA box
until F-27's box map says so.

Issue/convert/`issue_credit_note` require `vat_category` on every line
(`INVOICE_LINE_MISSING_VAT_CATEGORY` / `BILL_LINE_MISSING_VAT_CATEGORY`
/ `CREDIT_NOTE_LINE_MISSING_VAT_CATEGORY`). Convert copies it from the
quotation line. Credit-note lines that reference
`original_invoice_line_id` copy `vat_category` the same way C already
copies `vat_rate` (C #14).

Rate CHECK enforced at Issue against `vat_tax_rule_versions` (F-23):
`standard_rated` → `vat_rate` equals the then-effective standard rate
(seeded 5.00); every other category → `vat_rate = 0`.

C's `suggest_invoice_line_income_account` (and the credit-note twin)
switches the lookup to `vat_category` when present: `standard_rated` →
`4000`/`4040`; `zero_rated` → `4010`; `exempt` → `4020`;
`designated_zone` → `4030`; `out_of_scope` → no auto-suggest (accountant
sets `income_account_id`). When `vat_category` is null (legacy draft),
the existing `vat_rate` heuristic remains.

**Backfill of already-issued lines:** `vat_rate = 5` → `standard_rated`;
`vat_rate = 0` and `income_account` `4010` → `zero_rated`; `4020` →
`exempt`; `4030` → `designated_zone`; `vat_rate = 0` otherwise →
`zero_rated` (that is what C's suggestion treated `0` as). Bill lines
with `vat_rate = 5` → `standard_rated`; `vat_rate = 0` →
`out_of_scope` is **not** assumed — bill-line backfill of non-5 is
`zero_rated` only when the accountant later corrects, default
`standard_rated` if `vat_rate = 5` else leave null and fail a
`calculate_vat_return` with `VAT_CATEGORY_UNBACKFILLED` rather than
guess exempt vs out-of-scope vs zero-rated on purchases.

### F-20 — Net payable is `2200`; refund receivable is `1420`; CGS uses existing VAT accounts

**Decision:** do **not** add a new FTA-payable account. COA `2200` is
already named "VAT Payable (Output VAT)" with description "net payable
per return". `1420` "VAT Refund Receivable from FTA" already exists for
**approved/claimed** refunds pending disbursement — not for a mere
negative net (that stays as a debit on `1400` until F-22).

Capital-goods adjustments: no dedicated account in the 1400/2200 band.
Annual CGS JE (F-5): decrease in recovery → `Dr 5800 Cr 1400`; increase
in recovery → `Dr 1400 Cr 5800`. Amount
`= initial_vat_recovered × (actual_use_pct − initial_recovery_pct) /
adjustment_period_years`, rounded to `numeric(18,2)`.

`2230` VAT Penalty Accrual exists and is inactive in the demo seed. F-28
may post to it only after the account is active for that company; if
inactive, the warning still computes and posting raises
`VAT_PENALTY_ACCOUNT_INACTIVE`.

Do not use `1430` (excise recoverable), `2220` (excise payable), or
`2240` (WHT) — different taxes.

### F-21 — Payment due date is the 28th of the following month

**Decision:** `payment_due_date = date (year, month_following(period_end), 28)`
per Rules §2.2. Example: tax period 1 Jan–31 Mar 2026 → due 28 Apr 2026.
This is **not** "period_end + 28 days" (that would be 28 Apr only by
coincidence for a 31 Mar end). Stored when `calculate_vat_return`
succeeds. No reminder engine (F-11 stands).

### F-22 — Refund eligibility is negative net VAT; carry-forward is the default

**Decision:** Rules §2.2 / §3.14: Net VAT Payable/(Refundable) =
Output − Input (including RCM both sides). If negative, the period's
`refund_claim_status = eligible`; otherwise `none`. There is **no** N
consecutive-periods setting.

Default treatment: **carry forward** — leave the debit on `1400`. Owner
`POST …/claim-refund` sets `claimed` and posts
`Dr 1420 Cr 1400` for the refundable amount (`entry_type =
'vat_refund_claim'`). Input tax generally recoverable within 5 years
from the end of the relevant tax period (Rules §2.2); claims outside
that window raise `VAT_REFUND_WINDOW_EXPIRED`. F does not submit the
FTA refund request (F-13 still "prepare, don't file").

### F-23 — Versioned VAT tax rules; F RPCs do not hardcode 5%

**Decision:** table `vat_tax_rule_versions` (global, not per-company —
UAE VAT is national), per Rules §2.1 / Part 5.1:

```
id              uuid pk
standard_rate   numeric(5,2) not null
cas_threshold   numeric(18,2) not null default 5000000  -- F-40, excl. VAT
vd_amount_threshold numeric(18,2) not null default 10000 -- F-39, advisor-confirm
effective_from  date not null unique
notes           text
created_at      timestamptz not null default now()
```

Global. Seed `standard_rate = 5.00`, `cas_threshold = 5000000`,
`vd_amount_threshold = 10000`, `effective_from = 2018-01-01`
(Federal Decree-Law No. 8 of 2017 as cited on COA `1400`). F's RCM,
apportionment, CGS, and return calculator resolve the rate by document
date. C/E line math already uses the stored `vat_rate`; F does not
recompute historical line VAT from this table.

No company-settings write API to edit versions — seed/SQL, same as
E-26. `vd_amount_threshold` is **not** treated as immutable law (F-39).

### F-24 — New `journal_entry_type` values for F-owned postings; RCM stays `purchase_invoice`

**Decision:** F-3 stands (RCM legs stay on `purchase_invoice`). F's
own period/claim postings need types, the same way D added
`ecl_provision` and E added `grni_accrual`:

```
vat_apportionment
vat_capital_goods_adjustment
vat_return_settlement
vat_payment
vat_refund_claim
vat_bad_debt_relief
vat_penalty
vat_period_correction
```

Advisory-lock namespaces (hashtext, namespace first): `vat:` (return
calculate/approve/file), `vap:` (apportionment), `cgs:` (capital
goods), `vbd:` (bad-debt claim), `vpy:` (VAT payment), `vpc:`
(next-period correction). Then the existing entry-number lock.

### F-25 — Purchase-side `vat_input_treatment` consolidates F-3 / F-4 / blocked input

**Decision:** do not add both `vat_treatment` and `is_mixed_use`. One
column on `bill_lines`:

```
vat_input_treatment: recoverable | reverse_charge | blocked_entertainment
                   | blocked_other | mixed_use
```

Nullable until Issue. Default at Issue if null: `recoverable` when
`vat_category = standard_rated`, else ignored (zero-rated/exempt/
out_of_scope/designated_zone purchases do not create recoverable input).

| Value | Issue posting | Later F reclass |
|---|---|---|
| `recoverable` | `Dr 1400` for charged VAT (E-17) | none |
| `reverse_charge` | no `1400` from `vat_total` (supplier charged 0); add `Dr 1410 Cr 2210` for self-assessed VAT (F-3) | none if fully recoverable; mixed/blocked still allowed as a separate line |
| `blocked_entertainment` | E still `Dr 1400`; F reclass `Dr 5580 Cr 1400` for the VAT amount at Issue in the **same** JE (Rules §2.2 — entertainment for non-employees) | not a later cron |
| `blocked_other` | same, reclass `Dr 5800 Cr 1400` (vehicles / employee benefits / other blocked) | same |
| `mixed_use` | E `Dr 1400` full; F-4 period-end RPC moves the non-recoverable slice `Dr 5800 Cr 1400` | F-4 |

Blocked reclass is in the Issue JE so the books never show recoverable
input that Rules §2.2 says is blocked. Mixed-use cannot be known until
the period's taxable/exempt split exists, so it waits for F-4.

### F-26 — Blocked VAT: `5580` entertainment vs `5800` other

**Decision:** E-2 named both accounts for F. COA `5580` is the
entertainment **expense** tagged `[Blocked Input VAT]` (and CT 50%
add-back — Module G). COA `5800` is the VAT-as-expense bucket. Blocked
entertainment VAT is posted to `5580` so it sits with that expense for
later CT. All other blocked / apportionment-irrecoverable VAT posts to
`5800`. Do not invent a third blocked account.

### F-27 — Internal VAT groups plus a versioned FTA box map; do not invent box numbers

**Amended by F-42 (2026-09-15):** seed `fta_box_code` for groups that
map to boxes 1 and 3–14. Leave Box 2 and CAS box null until screenshot.

**Decision:** the Accounting Rules PDF does not list VAT 201 box
numbers. F calculates **internal groups** (stable, grounded in
`vat_category` + direction):

| Group key | Source |
|---|---|
| `out_standard_rated` | issued invoice lines `standard_rated` in period, minus matching credit-note lines |
| `out_zero_rated` | invoice/CN `zero_rated` |
| `out_exempt` | invoice/CN `exempt` (disclosure; not in net VAT) |
| `out_out_of_scope` | invoice/CN `out_of_scope` (disclosure) |
| `out_designated_zone` | invoice/CN `designated_zone` (disclosure until box map says otherwise) |
| `out_reverse_charge` | bill-line RCM `2210` credits in period |
| `out_bad_debt_relief` | claimed F-6 amounts (reduces output) |
| `in_standard_rated` | issued bill lines recoverable input (`1400` / `1410`) |
| `in_blocked` | `5580`/`5800` reclass in period (not recoverable) |
| `in_apportionment` | F-4 slice |
| `in_capital_goods` | F-5 signed adjustment |
| `net_payable` | Rules §3.14 Output − Input |

`vat_return_box_definitions`: `group_key`, `fta_box_code` (nullable
text), `fta_box_label`, `effective_from`, unique `(group_key,
effective_from)`. Export and stub-file require every non-zero group to
have a non-null `fta_box_code`. Calculate/review/drill-down work on
`group_key` without that seed. Filling `fta_box_code` for Box 2 and the CAS box waits on F-42.

Drill-down rows (`vat_return_line_item_sources`) reference exactly one
of `invoice_line_id` / `credit_note_line_id` / `bill_line_id` /
`journal_line_id` / `write_off_id`.

### F-28 — Penalty exposure is a warning, not an auto-posted journal

**Decision:** Rules §2.3 / §3.14. `GET /vat-returns/:id` includes
computed exposure (late filing AED 1,000 first / AED 2,000 repeat
within 24 months; late payment 14% × days/365; voluntary disclosure
1%/month on the difference). **No auto-post** (Part 5.2). Owner may
`POST /vat-returns/:id/accrue-penalty` → `Dr 5810 Cr 2230` if they
want it on the books (`entry_type = 'vat_penalty'`). `5810` VAT
Penalties & Fines already exists in the COA (CT non-deductible — G).
If `2230` is inactive, token `VAT_PENALTY_ACCOUNT_INACTIVE`.

### F-29 — VAT tax-period frequency is a setting, default quarterly

**Decision:** Rules §2.2: returns are generally quarterly; some large
taxpayers monthly. Additive `company_settings.vat_return_frequency
text not null default 'quarterly'` CHECK `in ('monthly','quarterly')`.
No write API (D-13). `calculate_vat_return` creates/uses
`vat_return_periods` whose `[period_start, period_end)` follows that
frequency and the company's `fiscal_year_start_month`. This is
independent of `accounting_periods` (usually monthly) and of
`default_period_length`.

### F-30 — VAT payment to FTA is an explicit RPC, routed like D-12

**Decision:** `record_vat_payment(return_id, amount, payment_date,
method)` posts `Dr 2200` (or `Dr 1420` when paying against a claimed
refund receivable) `Cr` D-12 routed cash (`1010`/`1020`/`1070`).
`entry_type = 'vat_payment'`. Does not create a `suppliers` row for
the FTA. Amount may not exceed the return's net payable (or `1420`
balance). Unattended payment is out of scope (same as E-7).

### F-31 — Approved return posts a settlement JE that nets `1400` against `2200`

**Decision:** on Owner `approve` (F-8), after calculate, RPC
`settle_vat_return` posts `entry_type = 'vat_return_settlement'`:

- Let `O` = period output movement on `2200`+`2210` (credit-positive).
- Let `I` = period recoverable input / FTA-receivable movement on
  `1400`+`1410`+`1415` (debit-positive), after blocked/apportionment/CGS
  reclasses (F-44).
- Transfer `T = min(O, I)`: `Dr 2200 Cr 1400` (and matching RCM wash
  `Dr 2210 Cr 1410` for the RCM portion).
- Remainder credit on `2200` = net payable (F-30 pays it).
- Remainder debit on `1400` = carry-forward (F-22); `claim-refund`
  later moves it to `1420`.

This is what COA `2200` "net payable per return" describes. Approve is
blocked if `reconcile_vat_return` would report a non-zero unexplained
variance (`VAT_RETURN_UNRECONCILED`).

### F-32 — Registration-threshold readout (Rules Part 5.4)

**Decision:** `GET /reports/vat-registration-threshold?as_of=` returns
rolling 12-month taxable supplies + imports (standard-rated +
zero-rated + RCM; **not** exempt/out-of-scope) versus Rules §2.2
thresholds AED 375,000 (mandatory) and AED 187,500 (voluntary). Flag
only — F does not auto-register with the FTA. `companies.trn` already
exists; a populated TRN means already registered.

### F-33 — [OPEN — USER] posted documents inside a filed VAT period

**Closed by F-38 / F-39 (2026-09-15):** account-keyed `VAT_PERIOD_FILED`
plus two-tier correction. Original options A/B below are historical.

**Rules §1.3:** once a period is closed/filed (e.g. after a VAT return
submission), prevent backdated postings unless an explicit prior-period
adjustment with re-approval. A's hard-close HTTP is still a stub
(`feature-spec.md` known open items).

**Not closed in this pass.** Options for the user:

- **A.** Filing a VAT return only locks `vat_return_periods` (F-14).
  Journal Issue/post in those dates still follow open `accounting_periods`
  only.
- **B.** Filing also rejects new ledger-truth postings dated in the
  filed VAT window (`VAT_PERIOD_FILED`) on invoice Issue, credit-note
  Issue, bill Issue, payments, write-off, ECL, GRNI, and manual JE
  post — unless the posting is the F-12 disclosure / F-24 adjustment
  path. Does **not** implement A's hard-close HTTP.

Do not implement B silently; it touches every posting RPC.

### F-34 — Sales-side reverse charge is out of this pass

**Decision:** deliverable #2 is "imported services" (purchase-side).
Rules §2.2 also names certain domestic supplies (e.g. specified metals).
Those are not modeled on `invoice_lines` in this pass. Revisit as F-38+
if needed.

### F-35 — Partial-exemption de-minimis stays deferred

**Decision:** F-4's OPEN on de-minimis is deferred to a follow-up. This
pass always runs the standard method when mixed-use lines exist. No
silent full-recovery shortcut.

### F-36 — [OPEN — USER] Capital Assets Scheme AED gate and 5-yr / 10-yr class split

**Closed by F-40 (2026-09-15).** Original "no gate" text below is
historical.

**Rules PDF does not state** the FTA Capital Assets Scheme monetary
threshold or which asset class takes 5 vs 10 years. F-5 stands:
accountant enters `adjustment_period_years` per item; no system
eligibility CHECK. Retention for capital-asset **records** is 10 years
(Rules §2.5) — that is record-keeping, not the VAT adjustment window.

User may later supply the FTA figures to append F-38+ as a gate.

### F-37 — [OPEN — USER] Bad-debt relief journal credit account

**Closed by F-41 (2026-09-15):** reject A and C; not B as worded.
`Dr 1415 Cr 5641`. Original A/B/C below are historical.

**Decision needed before build of the relief JE.** F-6 still creates
the claim row from D's flag and feeds `out_bad_debt_relief`. The debit
is `2200` (reduce output VAT). The credit is **not** in the PDF or COA
as a named VAT-relief account. Options:

- **A.** Claim affects the VAT 201 group only; GL impact is entirely
  F-31 settlement (no dedicated relief JE). Simplest; D already took
  the AR/P&L hit via `1110`.
- **B.** `Dr 2200 Cr 1110` (give the allowance the VAT portion back).
- **C.** `Dr 2200 Cr 1400` (wash through input VAT — usually wrong).

Do not pick A/B/C silently.

### F-38 — Filed VAT period lock is one account-keyed rule (closes F-33)

**Decision:** once `vat_return_periods.status = filed`, reject any new
ledger-truth posting whose **document tax point or journal `entry_date`**
falls in `[period_start, period_end)` with token `VAT_PERIOD_FILED`,
when **either**:

1. Any journal line's `account_number` is in the VAT-relevant set:
   `1400`, `1410`, `1415`, `1420`, `2200`, `2210`, `2230`, `5580`,
   `5800`, `5641`; or
2. The posting **Issues or voids** an invoice, credit note, or bill
   (those documents feed VAT 201 groups even when `vat_total = 0` —
   zero-rated/exempt/out-of-scope would otherwise slip the account
   check).

One shared `assert_not_filed_vat_period(...)` helper in `schema.sql`,
called from every posting RPC — **not** a Nest whitelist of types.
A manual JE that credits `2200` is blocked the same way as an invoice
Issue. A's hard-close HTTP stays a stub.

**Not blocked** (do not restate VAT): customer/supplier trade payments
that only hit `1100`/`2000`/`1010`/`1020`/`1070`; ECL (`5640`/`1110`);
GRNI (`2020`); write-off (`1110`/`1100`/`5640`) unless a line also hits
the VAT-relevant set. Write-off does not change the filed VAT 201; the
relief JE (F-41) posts in an **open** period.

**Allowed in a filed window:** nothing operational. Corrections date
into the **next open** VAT period (F-39), not back into the filed one.

Does not implement accounting-period hard-close.

### F-39 — Two-tier correction: next-period vs Form 211 (closes F-33 path)

**Decision:** a discovered error against a filed return never posts
into the filed window (F-38). Route:

| Trigger | Path |
|---|---|
| Absolute tax difference ≤ `vd_amount_threshold` (seeded AED 10,000) **and** no Emirate-mismatch | Inline **next-period correction**: JE dated in the current/next **unfiled** VAT period, `entry_type = vat_period_correction`, linked `original_vat_return_period_id`. Amounts flow into that next return's groups. No Form 211. |
| Tax difference > threshold, **or** Emirate-mismatch on a standard-rated supply (FTA Decision No. 8 of 2024 — even when net tax payable is unchanged) | **Voluntary Disclosure** (F-12): Form 211 template, Owner approval, `due_by = add_business_days(discovered_at, 20)` using D-10 holidays/weekends. Warn if overdue; do not auto-submit. |

`vd_amount_threshold` lives on `vat_tax_rule_versions` (F-23), not a
hardcoded constant. **Tax advisor must confirm AED 10,000 is still
current** before go-live (§0 residual): some commentary claims the
threshold was removed in 2023; sources citing Art. 10 / Cabinet
Decision 74/2023 still describe it. Both workflows are built; flipping
the seed to 0 forces everything through VD.

Emirate-mismatch: a correction that changes `invoice_lines.emirate` (or
the CN copy) on a `standard_rated` line, without a net-tax delta, still
takes the VD path. Flag this trigger to the company's tax advisor — it
is easy to miss.

### F-40 — Capital Assets Scheme gate (closes F-36)

**Decision:** owner-confirmed rule of thumb, stored as
`cas_threshold` (seeded AED 5,000,000, **excluding VAT**) on
`vat_tax_rule_versions`.

| Condition | System behaviour |
|---|---|
| Cumulative qualifying spend on the **project** < threshold | CAS does not apply. Hide `capital_goods_items` / adjustment fields. |
| Cumulative ≥ threshold and `asset_category = building_real_estate` | Auto-create/flag CAS item; `adjustment_period_years = 10`. |
| Cumulative ≥ threshold and `asset_category = other` | Same; `adjustment_period_years = 5`. |

Years are defaulted from category, not free-text. Owner may override
5↔10 only with a stored `period_override_reason` (rare).

**Staged payments:** CAS eligibility is **not** a per-bill-line check.
`capital_goods_projects` accumulates `bill_lines` net (excl. VAT)
tagged to the project. Individually small progress bills that together
cross AED 5,000,000 still become one CAS item. A bill line without a
project_id is evaluated on that line's own net only.

No dedicated CGS GL account (F-20 stands): annual adjustment remains
`Dr 5800 Cr 1400` / `Dr 1400 Cr 5800`.

### F-41 — Bad-debt VAT relief JE is `Dr 1415 Cr 5641` (closes F-37)

**Decision:** every VAT 201 figure needs a ledger entry (reject F-37 A).
Do not credit `1400` (reject F-37 C) — that mixes FTA-reclaim-from-bad-debt
with ordinary purchase input VAT and makes either population
unauditable. F-37 B (`Dr 2200 Cr 1110`) is the wrong debit **and**
credits the allowance rather than reversing the expense that is no
longer an economic loss.

Claim (when D's `vat_relief_eligible` is true and Owner claims):

- **Debit `1415`** VAT Receivable, Bad Debt Relief — dedicated
  recoverable sub-account. The customer still owes AR; only the VAT
  slice is reclaimed from the FTA.
- **Credit `5641`** Bad Debt Recovery — dedicated contra-expense,
  not `5640`. Gross write-off expense and recoveries stay visible
  separately.

`entry_type = vat_bad_debt_relief`. F-31 settlement later washes
`1415` against `2200` (`Dr 2200 Cr 1415`) so net payable on the return
ties to the GL. Same "distinct concept → distinct account" discipline
as E-23 `1350` and D-7 leaving `2050` off `2060`.

**COA extension at F build** (slots confirmed empty in the 2026-09-13
seed): add `1415` (asset, Tax Recoverable, debit) and `5641` (expense,
Depreciation & Amortization, **credit** normal_balance as
contra-expense — pair of `4060`/`5060` shape). Update
`seed_finalized_coa_demo_company_0002.sql` + Excel +
`verify_chart_of_accounts.sql` count (184 → 186), same as E-23.

If a written-off invoice is later recovered, reverse this JE
(`reverse_journal_entry`) and set claim `reversed`.

### F-42 — VAT 201 box map (closes F-27 for boxes we can seed)

**Decision:** seed `vat_return_box_definitions` from the owner table
(cross-referenced UAE filing guides, **not** the official FTA PDF —
tax.gov.ae blocked automated fetch). Internal groups still drive
calculate/review.

| Box | Label | Internal group(s) |
|---|---|---|
| 1 | Standard-rated supplies (**by Emirate**) | `out_standard_rated` + `emirate` |
| 3 | Supplies subject to reverse charge | `out_reverse_charge` |
| 4 | Zero-rated supplies | `out_zero_rated` |
| 5 | Exempt supplies | `out_exempt` |
| 6 | Goods imported into UAE (FTA auto-fills from customs/TRN) | `in_imports_customs` (reconciling only; do not pretend we replace customs) |
| 7 | Adjustments to imported goods | `in_import_adjustments` |
| 8 | Total output tax | derived (1+3+… as the form specifies) |
| 9 | Standard-rated expenses (recoverable input tax) | `in_standard_rated` |
| 10 | Imports subject to reverse charge (input side) | RCM input (`1410`) |
| 11 | Total input tax | derived |
| 12 | Total payable tax | derived |
| 13 | Total recoverable tax | derived |
| 14 | Net VAT payable / refundable | `net_payable` |

**Not confirmed — `fta_box_code` stays null until EmaraTax screenshot:**
Box 2 (label unknown); the box "designated for capital asset scheme
adjustments" (`in_capital_goods`). Export/file remain blocked
(`VAT_BOX_MAP_INCOMPLETE`) for any **non-zero** group whose box is
still null. `out_out_of_scope` / `out_designated_zone` stay disclosure
groups until the screenshot says otherwise.

Box 1 storage: one `vat_return_line_items` row per emirate per period
for `out_standard_rated`, not a single UAE total.

### F-43 — `uae_emirate` on sales lines (Box 1 + F-39 mismatch)

**Decision:** additive enum and column, required at Issue for
`vat_category = standard_rated`:

```
create type uae_emirate as enum (
  'abu_dhabi', 'dubai', 'sharjah', 'ajman',
  'umm_al_quwain', 'ras_al_khaimah', 'fujairah'
);
```

On `quotation_lines`, `invoice_lines`, `credit_note_lines`:
`emirate uae_emirate` nullable until Issue. Convert/CN copy from the
source line. Missing on a standard-rated invoice/CN line at Issue →
`INVOICE_LINE_MISSING_EMIRATE`. Optional on other `vat_category`
values. Optional `company_settings.default_emirate` (seed/SQL only,
D-13) copied onto new lines.

No emirate on `bill_lines` in this pass (Box 1 is output supplies).

### F-44 — F-31 settlement includes `1415`

**Decision:** F-31 `I` (recoverable input / FTA receivable to wash)
includes period debit movement on `1415` as well as `1400`+`1410`.
Relief claimed in the period reduces net payable via
`Dr 2200 Cr 1415` in the settlement JE, not by leaving `1415` hanging
off the trial balance.

---

## 3. Schema (additive — fold into `schema.sql` at build; no `apply_*.sql`)

All new tables: `company_id` where tenant-owned, RLS
`company_isolation_*` via `app.current_company_id`, grants to
`service_role` only (A §5.1 / §12). Money `numeric(18,2)`. Nested
`:id` resources added to `CompanyResourceKind`.

### 3.1 Enums

```
create type vat_category as enum (
  'standard_rated', 'zero_rated', 'exempt', 'out_of_scope', 'designated_zone'
);
create type vat_input_treatment as enum (
  'recoverable', 'reverse_charge', 'blocked_entertainment',
  'blocked_other', 'mixed_use'
);
create type vat_return_status as enum (
  'draft', 'calculated', 'under_review', 'approved', 'filed', 'superseded'
);
create type vat_refund_claim_status as enum ('none', 'eligible', 'claimed');
create type vat_relief_claim_status as enum (
  'pending_eligible', 'claimed', 'reversed'
);
create type uae_emirate as enum (
  'abu_dhabi', 'dubai', 'sharjah', 'ajman',
  'umm_al_quwain', 'ras_al_khaimah', 'fujairah'
);
create type capital_asset_category as enum (
  'building_real_estate', 'other'
);
create type vat_correction_path as enum (
  'next_period', 'voluntary_disclosure'
);
```

`journal_entry_type` gains the values in F-24 (including
`vat_period_correction`).

### 3.2 Additive columns on existing tables

`quotation_lines`, `invoice_lines`, `credit_note_lines`, `bill_lines`:
`vat_category vat_category` (nullable until Issue).

`quotation_lines`, `invoice_lines`, `credit_note_lines`:
`emirate uae_emirate` (nullable until Issue; required for
`standard_rated` — F-43).

`bill_lines`: `vat_input_treatment vat_input_treatment` (nullable until
Issue); `capital_goods_project_id uuid` (F-40, optional).

`company_settings`:

```
fta_api_enabled        boolean not null default false
vat_return_frequency   text not null default 'quarterly'
  check (vat_return_frequency in ('monthly', 'quarterly'))
default_emirate        uae_emirate   -- F-43; seed/SQL only
```

No PATCH API for these (D-13/E-26).

### 3.3 `vat_tax_rule_versions` (F-23)

See F-23. Seed `standard_rate = 5.00`, `cas_threshold = 5000000`,
`vd_amount_threshold = 10000`, `effective_from = 2018-01-01`.

### 3.4 `vat_return_box_definitions` (F-27)

```
id              uuid pk
group_key       text not null
fta_box_code    text
fta_box_label   text not null
effective_from  date not null
unique (group_key, effective_from)
```

### 3.5 `vat_return_periods`

```
id                   uuid pk
company_id           uuid not null references companies(id)
period_start         date not null
period_end           date not null          -- exclusive, same half-open as accounting_periods
status               vat_return_status not null default 'draft'
payment_due_date     date                   -- F-21, set on calculate
refund_claim_status  vat_refund_claim_status not null default 'none'
output_vat           numeric(18,2) not null default 0
input_vat            numeric(18,2) not null default 0
net_vat              numeric(18,2) not null default 0
retention_until      date                   -- F-14 / Rules §2.5
settlement_journal_entry_id uuid references journal_entries(id)
calculated_at        timestamptz
calculated_by        uuid
reviewed_by          uuid
reviewed_at          timestamptz
approved_by          uuid
approved_at          timestamptz
filed_at             timestamptz
filed_by             uuid
created_at           timestamptz not null default now()
updated_at           timestamptz not null default now()
unique (company_id, period_start)
check (period_end > period_start)
```

Filed rows: trigger blocks UPDATE of amounts/status except to
`superseded` via F-12. Lock `vat:` || company_id.

### 3.6 `vat_return_line_items` / `vat_return_line_item_sources`

One row per `(period_id, group_key)` with `amount numeric(18,2)` and
optional `fta_box_code` snapshot. Sources table: exactly one FK
populated (XOR CHECK).

### 3.7 `vat_apportionment_calculations`

```
period_id          uuid pk references vat_return_periods(id)
taxable_output     numeric(18,2) not null
exempt_output      numeric(18,2) not null
recoverable_pct    numeric(9,6) not null
journal_entry_id   uuid references journal_entries(id)
calculated_at      timestamptz not null
calculated_by      uuid not null
```

### 3.8 `capital_goods_projects` / `capital_goods_items` / `capital_goods_adjustments`

```
-- projects (F-40 staged payments)
id                       uuid pk
company_id               uuid not null
description              text not null
asset_category           capital_asset_category not null
created_by               uuid not null
created_at               timestamptz not null default now()

-- items
id                       uuid pk
company_id               uuid not null
project_id               uuid references capital_goods_projects(id)
description              text not null
acquisition_date         date not null
capital_value            numeric(18,2) not null check (capital_value > 0)
initial_vat              numeric(18,2) not null
initial_recovery_pct     numeric(5,2) not null check (initial_recovery_pct between 0 and 100)
adjustment_period_years  smallint not null check (adjustment_period_years in (5, 10))
period_override_reason   text
bill_line_id             uuid references bill_lines(id)
created_by               uuid not null
created_at               timestamptz not null default now()
```

`capital_goods_adjustments` unchanged from F-5. Cumulative project net
(excl. VAT) vs `cas_threshold` gates whether an item may exist (F-40).
`adjustment_period_years` defaults 10 / 5 from `asset_category`.

### 3.9 `vat_bad_debt_relief_claims`

```
id              uuid pk
company_id      uuid not null
write_off_id    uuid not null references write_offs(id) unique
vat_amount      numeric(18,2) not null check (vat_amount > 0)
status          vat_relief_claim_status not null default 'pending_eligible'
vat_return_period_id uuid references vat_return_periods(id)
journal_entry_id uuid references journal_entries(id)  -- set on claim; F-41
claimed_at      timestamptz
created_at      timestamptz not null default now()
```

`vat_amount` = the VAT portion of the written-off invoice (from issued
invoice lines' VAT, not re-derived). Eligibility to insert: D's
`vat_relief_eligible = true`.

### 3.10 `vat_voluntary_disclosures`

```
id                    uuid pk
company_id            uuid not null
original_period_id    uuid not null references vat_return_periods(id)
error_description     text not null
corrected_figures     jsonb not null
delta_net_vat         numeric(18,2) not null
path                  vat_correction_path not null default 'voluntary_disclosure'
emirate_mismatch      boolean not null default false
discovered_at         date not null
due_by                date not null  -- add_business_days(discovered_at, 20)
status                text not null  -- draft | approved
approved_by           uuid
approved_at           timestamptz
created_by            uuid not null
created_at            timestamptz not null default now()
```

Approving a **voluntary_disclosure** row sets the original period to
`superseded` and inserts a new `vat_return_periods` row linked via
`supersedes_period_id`. Does not call the FTA adapter. Next-period
corrections use §3.13 instead of this table when `path = next_period`.

### 3.13 `vat_period_corrections` (F-39, below-threshold)

```
id                         uuid pk
company_id                 uuid not null
original_period_id         uuid not null references vat_return_periods(id)
correction_period_id       uuid not null references vat_return_periods(id)
delta_net_vat              numeric(18,2) not null
journal_entry_id           uuid references journal_entries(id)
created_by                 uuid not null
created_at                 timestamptz not null default now()
check (correction_period_id <> original_period_id)
```

### 3.11 `fta_filing_log`

```
id                 uuid pk
vat_return_period_id uuid not null references vat_return_periods(id)
attempted_at       timestamptz not null default now()
adapter_status     text not null   -- not_available | submitted | error
adapter_response   jsonb
attempted_by       uuid not null
```

Stub always writes `not_available`.

### 3.12 `vat_invoice_register` (view)

Over `invoices` where `invoice_number is not null`, per company per
calendar year of `INV-YYYY-`. Columns: `invoice_number`, `status`,
`invoice_date`, `grand_total`, `gap_before` boolean (true when the
numeric suffix is not exactly prior+1). Voids are rows, not gaps.

---

## 4. Business rules

§4.1–§4.17 follow the deliverable map. Citations: F-n and Rules § as
named.

### 4.1 VAT category (F-1, F-19, F-23, F-43)

Every sales and purchase line that can hit a VAT 201 group carries
`vat_category`. `vat_rate` remains the numeric used by existing line
math (`set_*_line_computed_fields`). Standard-rated lines must match
the effective `vat_tax_rule_versions.standard_rate` at Issue **and**
carry `emirate` (Box 1). Zero-rated, exempt, out-of-scope,
designated-zone: `vat_rate = 0`. Designated-zone is disclosure/review
until the box map says otherwise.

### 4.2 Reverse charge — imported services (F-3, F-25)

Purchase-side only. Line `vat_input_treatment = reverse_charge`,
`vat_category = standard_rated`, `vat_rate = 0`. Issue RPC adds
`Dr 1410 Cr 2210` for round(net × standard_rate, 2) on that line.
Header `vat_total` unchanged (supplier charged 0). Same
`purchase_invoice` JE. Recoverable unless the line is also blocked
(use two lines, do not overload one line with RCM+blocked).

### 4.3 Partial exemption (F-4, F-25, F-35)

`calculate_partial_exemption(period)`: taxable_output = sum of issued
invoice lines in the VAT period with `vat_category in (standard_rated,
zero_rated)` net of credit notes; exempt_output = `exempt` net of CNs.
`recoverable_pct = taxable_output / (taxable_output + exempt_output)`
when the denominator > 0, else 0. Apply to `mixed_use` bill lines'
input VAT: irrecoverable = round(input × (1 − recoverable_pct), 2);
`Dr 5800 Cr 1400`, `entry_type = vat_apportionment`. De-minimis off
(F-35). Explicit RPC, lock `vap:`.

### 4.4 Capital goods scheme (F-5, F-20, F-40)

`capital_goods_projects` accumulate bill-line net excl. VAT. Below
`cas_threshold` (seeded AED 5,000,000): no CAS item, fields hidden.
At/above: auto-flag; years 10 if `building_real_estate`, else 5.
Staged payments on one project count as one item. Annual
`run_capital_goods_adjustment` as F-20. Lock `cgs:`. Never a cron.

### 4.5 Bad debt relief (F-6, F-18, F-41)

Insert claim when `write_offs.vat_relief_eligible = true`. Do not
re-run the 6-month clock. Owner claim posts `Dr 1415 Cr 5641`,
`entry_type = vat_bad_debt_relief`, and feeds `out_bad_debt_relief`.
Later recovery: `reverse_journal_entry` + status `reversed`. If the
original VAT period is already filed, the reversing effect follows
F-39 (next-period vs VD) rather than posting into the filed window.

### 4.6 VAT 201 calculator + settlement (F-7, F-27, F-31)

`calculate_vat_return(company_id, period_start)` uses F-29 frequency
to set `period_end`, lock `vat:`, populate groups from issued (not
draft, not void-without-number) documents whose tax point
(`invoice_date` / `bill_date` / `credit_note_date`) is in
`[period_start, period_end)`, using `is_ledger_truth_status` on the
linked JE. Void-in-period nets to zero via the reversal JE.
`payment_due_date` from F-21. Status `calculated`.

Owner approve runs F-31 settlement. Recalculate allowed only from
`draft` / `calculated` / `under_review`, never `approved` / `filed`.

### 4.7 Drill-down (F-7, F-27)

`GET …/groups/:group_key/transactions` reads
`vat_return_line_item_sources` for that calculated period.

### 4.8 Review / approval (F-8)

Accountant: `calculated → under_review`. Owner: `under_review →
approved` (settlement JE) then `approved → filed` (human attestation;
stub adapter log). Owner/Manager still approve F's own JEs when above
`journal_approval_threshold` (A).

### 4.9 FTA portal export (F-9, F-27)

CSV/XLSX of groups in box-map order. Blocked without complete
`fta_box_code` coverage. No generic export framework.

### 4.10 E-filing adapter (F-10)

Stub. `fta_api_enabled` default false. `POST …/file` stamps `filed`
and writes `fta_filing_log.not_available`. Never HTTP to FTA.

### 4.11 Payment due date (F-11, F-21)

Column only. Future reminder module reads it.

### 4.12 Voluntary disclosure and next-period correction (F-12, F-39)

F-38 forbids posting into a filed VAT window. Route the error (F-39):
next-period correction below the versioned amount threshold with no
Emirate-mismatch; Form 211 VD above it, or on Emirate-mismatch even
at zero net-tax delta, due 20 business days from discovery. Owner
approval. Penalty warning F-28. No FTA submission.

### 4.13 Refund claim (F-22)

Negative net → `eligible`. Owner claim → `Dr 1420 Cr 1400`. 5-year
window. No FTA submission.

### 4.14 Immutable record and post-filing lock (F-14, F-38)

Filed returns append-only. Retention_until = period_end + longest
applicable Rules §2.5 period. No purge.

`assert_not_filed_vat_period` on every posting RPC (F-38): VAT-relevant
account set **or** invoice/CN/bill Issue/void. Token `VAT_PERIOD_FILED`.
Does not implement A's hard-close.

### 4.15 Audit pack (F-15)

JSON aggregation: return, groups, sources, invoice register, JEs,
write-off flags. No PDF.

### 4.16 Sequential register (F-16)

`GET /reports/invoice-register?year=` over `INV-YYYY-NNNN`. Voids
visible. True gaps flagged. Not bills, not credit notes.

### 4.17 Reconciliation (F-17, F-31)

Group totals vs GL movement on `1400`/`1410`/`1415`/`1420`/`2200`/`2210`/
`5580`/`5800`/`2230`/`5641` for the VAT window, `is_ledger_truth_status`.
Non-zero unexplained variance blocks approve.

### 4.18 Penalty warning (F-28)

Computed on GET; optional Owner accrue.

### 4.19 VAT payment (F-30)

Explicit RPC; D-12 cash routing; not a supplier payment.

### 4.20 Next-period correction vs VD routing (F-39)

`POST /vat-returns/:id/corrections` with `discovered_at`, delta, and
whether any standard-rated `emirate` changed. Server picks the path.
Does not accept a client-supplied path that would bypass VD when the
threshold or mismatch requires it.

---

## 5. API

Same guard stack as C/D/E: `SupabaseAuthGuard` +
`CompanyMembershipGuard` + `@RequireCompanyMembership`. Actor ids from
`@CurrentUser()`. Static paths before `:id`.

| Method | Route | Decision |
|---|---|---|
| POST | `/vat-returns/calculate` | F-7 / F-29 — body `{ period_start }` |
| GET | `/vat-returns` | list by company |
| GET | `/vat-returns/:id` | F-7 + F-28 warning fields |
| GET | `/vat-returns/:id/groups/:group_key/transactions` | F-7 drill-down |
| POST | `/vat-returns/:id/submit-for-review` | F-8 Accountant |
| POST | `/vat-returns/:id/approve` | F-8 / F-31 Owner |
| POST | `/vat-returns/:id/file` | F-10 Owner, stub |
| GET | `/vat-returns/:id/export` | F-9 / F-27 |
| POST | `/vat-returns/:id/reconcile` | F-17 |
| POST | `/vat-returns/:id/claim-refund` | F-22 Owner |
| POST | `/vat-returns/:id/record-payment` | F-30 |
| POST | `/vat-returns/:id/accrue-penalty` | F-28 Owner |
| POST | `/vat-apportionment/:vatReturnId/calculate` | F-4 |
| CRUD | `/capital-goods-items` | F-5 |
| POST | `/capital-goods-items/:id/adjust` | F-5 — body `{ fiscal_year, actual_use_pct }` |
| POST / GET | `/bad-debt-relief-claims` | F-6 — insert from eligible write-off |
| POST | `/bad-debt-relief-claims/:id/claim` | F-41 Owner — posts Dr 1415 Cr 5641 |
| GET | `/vat-voluntary-disclosures` | F-12 / F-39 — list (`company_id`) |
| GET | `/vat-voluntary-disclosures/:id` | F-12 |
| POST | `/vat-voluntary-disclosures/:id/approve` | F-12 / F-39 Owner |
| POST | `/vat-returns/:id/corrections` | F-39 — server chooses next-period vs VD (inserts a VD when that path applies; no client POST-create on `/vat-voluntary-disclosures`) |
| GET / POST / PATCH / DELETE | `/capital-goods-projects` | F-40 |
| GET | `/reports/invoice-register` | F-16 |
| GET | `/reports/vat-audit-pack/:id` | F-15 |
| GET | `/reports/vat-registration-threshold` | F-32 |

No company-settings write API. Resource kinds:
`vat_return_period`, `capital_goods_item`, `capital_goods_project`,
`vat_bad_debt_relief_claim`, `vat_voluntary_disclosure`,
`vat_period_correction`.

---

## 6. Relationship to existing schema

New tables: §3.3–§3.13. Additive columns: §3.2 (`vat_category`,
`emirate`, `vat_input_treatment`, `capital_goods_project_id`). F extends
C/E Issue RPCs (vat_category required; emirate on standard-rated sales;
RCM/blocked legs on `create_bill_journal_entry`; `VAT_PERIOD_FILED`).
F extends `journal_entry_type`. Additive COA `1415` / `5641` at F build
(F-41). F does not change `customers`, `suppliers`, `payments`,
`supplier_payments`, or D's `mark_vat_relief_eligible` clock.

C income-account suggestion reads `vat_category` when set (F-19).

---

## 7. Out of scope for this pass

- **Actual FTA portal submission or FTA API filing** — F-9/F-10.
- **Actual VAT 211 filing or refund-claim filing** — F-12/F-13/F-22.
- **E-invoicing / Peppol PINT AE / ASP** — Rules §2.6; not Module F.
- **Corporate Tax / QFZP / SBR / free-zone income** — Module G.
- **PDF/XLSX/CSV rendering mechanics generally** — H-remainder; F owns
  the FTA-specific data shape (F-9). Standing 2026-09-20: H2-7 closed
  CSV for H1 four + H2 report routes only; F VAT CSV/PDF/XLSX rendering
  beyond F-9 remains deferred.
- **A live payment-reminder/notification engine** — F-11.
- **Multi-currency VAT.**
- **Company-settings admin API/UI** — D-13/E-26.
- **Sales-side reverse charge** — F-34.
- **Partial-exemption de-minimis** — F-35.
- **Auto-posting penalties** — F-28 warn only.
- **Purging records after retention_until** — F-14 stores the date only.
- **Activating demo-inactive COA rows (`4030`, `2230`) for every tenant**
  — per-company COA; F uses them when active.
- **Seeding Box 2 / CAS box** — waits on an EmaraTax screenshot (F-42).
- **Treating `vd_amount_threshold` as immutable law** — advisor-confirm
  (F-39).

---

## 8. Build status / sign-off

**Module 1.1.F is built (2026-09-16).** Status is ✅. §0 residuals remain
(10k advisor-confirm is a seeded default, not a schema blocker; Box 2/CAS
screenshot blocks **export only**).

### Closed

1. `vat_rate` / line shape (F-18).
2. COA: `1420`, `2200` as net payable, `2230`, `5800`/`5580`/`1410`/`2210`
   (F-20, F-26); `1415`/`5641` additive at F build (F-41).
3. D 6-month clock = `invoice_date` + `debtor_notified_at` (F-18).
4. Payment due date = 28th of following month (F-21).
5. Refund = negative net, carry-forward default, 5-year window (F-22).
6. Versioned 5% / CAS 5m / VD 10k table (F-23 / F-39 / F-40).
7. VAT 201 boxes 1, 3–14 seeded from filing guides (F-42); Box 1 by Emirate (F-43).
8. De-minimis deferred (F-35); sales-side RCM deferred (F-34).
9. Post-filing lock (F-38); two-tier correction (F-39); CAS gate (F-40);
   relief JE `Dr 1415 Cr 5641` (F-41).
10. Additive COA `1415` / `5641` in `seed_finalized_coa_demo_company_0002.sql`
    (demo company 186 accounts).

### Residual (not schema blockers)

1. Tax advisor confirms AED 10,000 `vd_amount_threshold` is still current
   (F-39). Seed 10000; set to 0 if the threshold was repealed.
2. EmaraTax screenshot for Box 2 and the CAS adjustment box before
   export mapping (F-42).

### Tests that lock the behavior

- `src/vat/vat.service.spec.ts` — F-8 / F-10 Nest role gates (approve/file/submit).
- `src/vat/vat-returns.integration.spec.ts` — F-7 / F-21 calculate (AED 50 output,
  due 2026-04-28); F-8 / F-24 file then `VAT_PERIOD_FILED` on Issue; Accountant
  cannot file.
- `src/invoices/invoices.integration.spec.ts` — C Issue still posts after F
  vat_category / emirate suggestion.
- `src/auth/company-membership.guard.integration.spec.ts` — F routes 403 across
  tenants.
- `src/common/controller-auth-coverage.spec.ts` — 200 guarded routes including F.

### Live notes (Testing 1.1.A, 2026-09-16)

F DDL/RPCs applied on project `kaihxmsskblynwjmwvfh`. New Issues get
`vat_category` / `emirate` from suggestion triggers. Historical issued lines
were not backfilled; `calculate_vat_return` raises `VAT_CATEGORY_UNBACKFILLED`
if a period still has null categories.

### Build-time discipline

1. Fold all DDL into `schema.sql` — no `apply_*.sql`.
2. Extend C/E Issue RPCs; do not reimplement posting in Nest.
3. Audit-sweep (Build Order §6 / A §7.16-style) on F-14, F-16, F-38,
   F-9/F-10, tenant isolation — not just a green test suite.
4. After F-45+, never silently edit; append F-n+.

---

## 9. Decision Log Index

| # | Date | Summary | Detail in |
|---|---|---|---|
| F-1 | 2026-09-14 | `vat_category` alongside `vat_rate`; schema OPEN closed by F-18/F-19 | §2 F-1 |
| F-2 | 2026-09-14 | Reuse E VAT accounts; payable/refund OPEN closed by F-20 | §2 F-2 |
| F-3 | 2026-09-14 | RCM inside `purchase_invoice` JE; flag moved by F-25 | §2 F-3 |
| F-4 | 2026-09-14 | Standard-method apportionment, explicit RPC; de-minimis → F-35 | §2 F-4 |
| F-5 | 2026-09-14 | CGS per-asset years; threshold stays F-36 | §2 F-5 |
| F-6 | 2026-09-14 | Relief reads D's flag; clock closed by F-18; JE credit → F-37 | §2 F-6 |
| F-7 | 2026-09-14 | VAT 201 explicit RPC + drill-down; groups/boxes → F-27 | §2 F-7 |
| F-8 | 2026-09-14 | Owner/Accountant review/approval, no new roles | §2 F-8 |
| F-9 | 2026-09-14 | F owns FTA export shape; H-remainder owns generic export | §2 F-9 |
| F-10 | 2026-09-14 | E-filing adapter, stub only | §2 F-10 |
| F-11 | 2026-09-14 | Due-date column, no reminder engine; date closed by F-21 | §2 F-11 |
| F-12 | 2026-09-14 | VAT 211 template, not submission | §2 F-12 |
| F-13 | 2026-09-14 | Refund status; cadence superseded by F-22 | §2 F-13 |
| F-14 | 2026-09-14 | Immutability inherited; filed returns append-only | §2 F-14 |
| F-15 | 2026-09-14 | Audit pack aggregates; H-remainder renders | §2 F-15 |
| F-16 | 2026-09-14 | Invoice register on C `invoice_number` only | §2 F-16 |
| F-17 | 2026-09-14 | Reconcile groups vs GL | §2 F-17 |
| F-18 | 2026-09-14 | Grounding: vat_rate shape, D clock, E reserved accounts | §2 F-18 |
| F-19 | 2026-09-14 | Category on quotes/CNs; `designated_zone`; Issue required; backfill | §2 F-19 |
| F-20 | 2026-09-14 | `2200` net payable, `1420` claimed refund, CGS via `1400`/`5800` | §2 F-20 |
| F-21 | 2026-09-14 | Due date = 28th of month after tax period (Rules §2.2) | §2 F-21 |
| F-22 | 2026-09-14 | Refund eligible iff net negative; carry-forward default; 5-year window | §2 F-22 |
| F-23 | 2026-09-14 | `vat_tax_rule_versions`; do not hardcode 5% in F RPCs | §2 F-23 |
| F-24 | 2026-09-14 | New JE types for F-owned posts; RCM stays `purchase_invoice` | §2 F-24 |
| F-25 | 2026-09-14 | `vat_input_treatment` on bill lines | §2 F-25 |
| F-26 | 2026-09-14 | Blocked entertainment VAT → `5580`; other → `5800` | §2 F-26 |
| F-27 | 2026-09-14 | Internal groups + versioned box map; no invented FTA box IDs | §2 F-27 |
| F-28 | 2026-09-14 | Penalty warning; optional accrue to `5810`/`2230` | §2 F-28 |
| F-29 | 2026-09-14 | `vat_return_frequency` default quarterly | §2 F-29 |
| F-30 | 2026-09-14 | `record_vat_payment` vs `2200`/`1420` and D-12 cash | §2 F-30 |
| F-31 | 2026-09-14 | Approve posts settlement JE netting `1400`/`2200` | §2 F-31 |
| F-32 | 2026-09-14 | Registration-threshold readout (375k / 187.5k) | §2 F-32 |
| F-33 | 2026-09-14 | Closed by F-38/F-39: account-keyed lock + two-tier correction | §2 F-33 |
| F-34 | 2026-09-14 | Sales-side RCM out of pass | §2 F-34 |
| F-35 | 2026-09-14 | De-minimis deferred | §2 F-35 |
| F-36 | 2026-09-14 | Closed by F-40: CAS AED 5m / 5-yr vs 10-yr | §2 F-36 |
| F-37 | 2026-09-14 | Closed by F-41: `Dr 1415 Cr 5641` | §2 F-37 |
| F-38 | 2026-09-15 | `VAT_PERIOD_FILED`: VAT accounts or invoice/CN/bill Issue | §2 F-38 |
| F-39 | 2026-09-15 | Next-period correction vs Form 211; 10k versioned; Emirate VD | §2 F-39 |
| F-40 | 2026-09-15 | CAS: AED 5m excl VAT; 10yr buildings; 5yr other; project cumulative | §2 F-40 |
| F-41 | 2026-09-15 | Relief JE `Dr 1415 Cr 5641`; COA extension at F build | §2 F-41 |
| F-42 | 2026-09-15 | VAT 201 boxes 1, 3–14 seeded; Box 2 + CAS box screenshot-gated | §2 F-42 |
| F-43 | 2026-09-15 | `uae_emirate` on standard-rated sales lines (Box 1) | §2 F-43 |
| F-44 | 2026-09-15 | F-31 settlement washes `1415` against `2200` | §2 F-44 |
