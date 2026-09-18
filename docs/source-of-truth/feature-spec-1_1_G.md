# Module 1.1.G — UAE Corporate Tax (9%) Add-On
## Feature Specification (Ratified 2026-09-18 — not yet implemented)

Part of Module 1.1 · AI-Based Accounting Foundation, inFINity Phase 1 (MVP).
This is the scope document for Module 1.1.G only — do not infer scope from
Module 1.1.A/C/D/E/F/H1.

**Status: ✅ Ratified 2026-09-18.** Build Order §7 lists G as sequenced
seventh — after A (Module 0), H-core (Module 1), and F (Module 6), all
three done. This spec follows the same numbered-decision discipline
`feature-spec.md` (A), `feature-spec-1.1.C.md` (C),
`feature-spec-1_1_D.md` (D), `feature-spec-1_1_E.md` (E), and
`feature-spec-1_1_F.md` (F) used: decisions are numbered (G-1…); once
written, nothing is silently edited — append G-N+. G-1…G-12 were the
first draft; G-13…G-21 ground it against `schema.sql`, the finalized
COA, and the Accounting Rules PDF; G-22…G-31 are the owner-decision
round; G-32 quotes the live YE signature and the XOR-FK pattern.
**Not yet implemented** — ratified means the spec is closed, not that
code exists (see §8).

**Grounding (re-read 2026-09-18):** `schema.sql`,
`seed_finalized_coa_demo_company_0002.sql` (186-account demo `…0002`),
`Accounting Rules - inFINity.pdf` §2.1 / §2.4 / §2.5 / §3.15 / Part 5,
Build Order §7. First-draft G-1…G-12 bodies stay as written; Closed-by
banners and standing rules (§0, §3–§8) are current.

**Build Order context:** per `Module_1.1_Build_Order_Scope.md` §7, G is
sequenced seventh. Separate `create_ct_provision_entry` with its own
`ct:` lock: G-1, confirmed G-22. Provision posts **before** YE; YE
raises `CT_PROVISION_NOT_POSTED` unless skipped (G-22 / G-32).

**Dependencies, verified against `schema.sql`:**
Module 0 (A) —
`create_year_end_closing_entry(uuid, integer, uuid, date, text) → jsonb`
(G-32); lock `ye:{company}:{fiscal_year}`; token
`YEAR_END_ALREADY_CLOSED`; `companies.trn`,
`companies.is_free_zone_entity`, `companies.fiscal_year_start_month`;
no-delete/reversal-only; `journal_approval_threshold`. No `ct_*` tables
exist yet. No `journal_entry_type` value `ct_provision` yet (additive
at G build). Module 1 (H-core) — `v_trial_balance`,
`get_general_ledger`, `GET /reports/profit-and-loss`. Module 6 (F) —
versioned tax-config *pattern* only; G does not read F's VAT tables
(G-24 / G-29).

**Confirmed against the finalized COA seed:**

| Purpose | Account | Active | Basis |
|---|---|---|---|
| CT expense (P&L) | `5830` Corporate Tax Expense | yes | `[Detail] Current + deferred CT expense per Federal Decree-Law No. 47/2022` |
| CT payable / provision | `2300` Corporate Tax Payable / Provision | yes | `[Control]` — **one** control (G-13), not a provision/payable split |
| Deferred tax asset | `1900` Deferred Tax Asset | no | G-28 — not this pass |
| Deferred tax liability | `2310` Deferred Tax Liability | no | G-28 |
| TP adjustment payable | `2320` Transfer Pricing Adjustment Payable | no | G-26 log only; no auto TP JE |
| QFZP qualifying income | `4300` Free Zone Income - Qualifying (0% CT) | yes | MD 229/2025; G-24 |
| QFZP non-qualifying income | `4310` Free Zone Income - Non-Qualifying (9% CT) | yes | de-minimis in the account description; G-16 |
| Mainland income of FZ entity | `4320` Mainland Income (Free Zone Entity) | no | always standard CT |
| Entertainment | `5580` Client Entertainment (Non-Deductible for CT) | yes | seed: 50% CT-deductible; G-18 |
| VAT penalties | `5810` VAT Penalties & Fines | yes | 100% CT add-back; G-18 |
| General fines | `5930` Fines & Penalties - General (Non-Deductible) | yes | 100% CT add-back; G-18 |
| Dividend income | `4610` Dividend Income | no | "May qualify for CT participation exemption" — never auto-exempt (G-25) |
| Related-party AR / AP | `1150` / `2030` | yes | IAS 24; G-26 does **not** post to them |
| Bank | `1020` | yes | FTA cash settlement out of this pass |
| Retained earnings | `3100` | yes, system | YE destination (A) |

**Accounting Rules sourced here** (PDF):

- §2.1 / Part 5.1 — Decree-Law 47/2022; versioned tax config.
- §2.4 — 0% to AED 375,000 then 9%; QFZP `(QI×0)+(NQI×9%)` with **no**
  375k band; de-minimis `MIN(5% revenue, AED 5,000,000)`; SBR election
  if revenue ≤ AED 3,000,000 in the current **and all prior** periods,
  through periods **ending on/before 31 December 2026**; filing +
  payment 9 months after tax-period end.
- §2.5 — CT records 7 years.
- §3.15 — taxable income formula; 50% entertainment.
- Part 5.2 — never auto-file. Part 5.5 VAT–CT cross-check → G-29.
- Part 5.8 — flag, don't auto-fix, SBR fragmentation.

---

## 0. Owner decisions (2026-09-18) — closed

Mirrors F's §0. Full text of each answer is G-22…G-31; G-32 closes the
two leftover schema-verification flags. Do not silently edit those
entries — append G-33+.

| # | Answer | Closes |
|---|---|---|
| Provision vs. year-end | Separate `create_ct_provision_entry`, `ct:` lock, `CT_PROVISION_ALREADY_POSTED`. Posts into the **last open period of the FY**, before YE runs. `create_year_end_closing_entry` **refuses** to close a fiscal year with no `posted` CT provision row unless an explicit `skip_ct_check` override with a reason is passed. | G-1 → G-22 |
| SBR election | Monitor only. No election table this pass; provision always applies the 0%/9% bands (or QFZP bands) unless a future pass adds election recording. | G-4 → G-23 |
| Free-zone tagging | Reuse COA `4300`/`4310`/`4320`; no new `ct_income_source` enum/column. Entity gate stays `companies.is_free_zone_entity`. | G-6 → G-24 |
| Adjustment list this pass | Add back 50% of `5580` + 100% of `5810`/`5930`; manual rows for qualifying dividends / intragroup transactions. No tax-loss carry-forward, interest cap, unrealized G/L, or participation-exemption automation. | G-5 → G-25 |
| Related party | New append-only `related_party_transactions` log. No customer/supplier flag reuse, no `1150`/`2030` posting, no arm's-length engine. | G-7 → G-26 |
| Who posts | Accountant may calculate/draft; Owner posts (F-8 analogue, no new role). | G-8/G-9 → G-27 |
| Deferred tax | Out of scope this pass (PDF §3.15 is current tax only). | New → G-28 |
| VAT–CT cross-check | Deferred to a follow-up or H-remainder (PDF Part 5.5). | New → G-29 |
| QFZP de-minimis breach | Flag only; never auto-strips the 0% rate. | G-6 → G-30 |
| Natural persons / tax groups | Out of scope; tenant model is `companies` only. | New → G-31 |

### No open residuals remain after G-22…G-32

Unlike F (which still carried the 10k VD threshold and the Box 2/CAS
screenshot as post-ratification residuals), G's grounding pass (G-13…
G-21) and this owner round (G-22…G-31) close every `[OPEN]` flag G-1…
G-12 raised. G-32 closes the two leftover schema-verification items
(YE signature, adjustment source FKs). §8 lists implementation-
readiness items — those are build tasks, not open spec questions.

---

## 1. Scope boundary

Source deliverables for this pass, each mapped to a section (as given
in the module request):

| # | Deliverable | Section |
|---|---|---|
| 1 | Taxable profit tracker: real-time running profit vs AED 375,000 threshold | §4.1 |
| 2 | Threshold alert: notification at AED 330,000 (90%) — configurable | §4.2 |
| 3 | CT provision: 9% on profit above threshold — auto-posts to CT Provision account | §4.3 |
| 4 | Small Business Relief monitor: eligibility under AED 3M revenue (valid until Dec 2026) | §4.4 |
| 5 | Exempt income identification: qualifying dividends, intragroup transactions | §4.5 |
| 6 | Free zone income classifier: qualifying free zone income at 0% CT | §4.6 |
| 7 | Related party transaction log for transfer pricing documentation support | §4.7 |
| 8 | CT return preparation summary: structured data export for FTA portal filing | §4.8 |
| 9 | CT payment due date: 9 months after FY end — imported to reminder module | §4.9 |

Plus items this spec adds because the Accounting Rules discipline F
established requires it (same reasoning F used to add GRNI-style items
beyond its own eighteen-item list) — flagged as additions, not silently
folded into the nine above:

| Extra | Section | Why in this pass |
|---|---|---|
| Versioned CT rate/threshold table | §3.3 / G-10 | Mirrors F-23 — 0%/9% rate, 375k threshold, 3M SBR revenue cap, and QFZP 0% rate must not be hardcoded in RPCs; UAE CT rates/thresholds are set by Cabinet/Ministerial Decision, not primary law, and can change |
| CT registration status readout | §4.10 / G-11 | Mirrors F-32's VAT registration-threshold readout, but CT registration in the UAE is mandatory for virtually all taxable persons regardless of profit — a very different trigger from VAT's revenue threshold; worth its own decision rather than copy-pasting F-32's logic |
| CT penalty-exposure warning | §4.11 / G-12 | Mirrors F-28 — compute and warn on late-filing/late-payment exposure; never auto-post a penalty accrual |
| Non-deductible expense adjustment layer | §4.5 / G-5 / G-18 / G-25 | COA `5580` (50%) plus `5810`/`5930` (100%); tracker cannot be "taxable profit" without these |

**Explicitly out of scope for this pass** (see §7 for detail): actual
submission to the FTA portal or FTA API; actual filing of a CT return;
a live payment-reminder/notification engine (mirrors F-11); the full
UAE CT adjustment list beyond G-25; transfer-pricing benchmark
analysis or arm's-length pricing calculation (only the transaction *log*
is in scope, §4.7); multi-entity UAE tax-group consolidation; natural
persons; deferred tax (G-28); VAT–CT cross-check (G-29); PDF/XLSX
rendering mechanics generally (H-remainder, same split F-9 used).

**Depends on:** Module 0 (A) — specifically the year-end closing RPC.
Module 1 (H-core) — for the running P&L the threshold tracker reads.
Module 6 (F) — for the categorization *pattern* only (Build Order §7);
no direct schema dependency on F's tables.

---

## 2. Decision log

Numbered G-1 onward. G-1…G-12 are the first-draft entries (bodies not
rewritten). G-13…G-21 close schema/COA/PDF verification. G-22…G-31 close
the owner round. G-32 quotes the live YE signature and replaces
`source_reference` with typed XOR FKs. **Do not silently edit a prior
entry — append G-N+.**

### G-1 — CT provision posts via a dedicated RPC, not an extension of year-end close

**Closed by G-14 / G-22 / G-32 (2026-09-18):** provision JE is `Dr 5830
Cr 2300` (G-13); YE zeros `5830` into `3100` (G-14). G-22: provision
posts into the FY's last open period **before** YE; YE raises
`CT_PROVISION_NOT_POSTED` unless skipped. Live YE signature is G-32.

**Decision:** CT provision posting is a separate
`create_ct_provision_entry(company_id, fiscal_year)` RPC, run after
`create_year_end_closing_entry` for the same fiscal year, rather than a
CT line folded into that existing RPC. It takes its own advisory-lock
namespace (`ct:`, following the `ob:`/`ye:` convention Build Order §7
already names) so a concurrent year-end close and CT provision run
cannot race each other, but the two remain independently invocable and
independently idempotent (mirrors Module 0's own
`YEAR_END_ALREADY_CLOSED` one-time-per-fiscal-year token — this RPC
gets its own equivalent, e.g. `CT_PROVISION_ALREADY_POSTED`).

**Why not extend the existing RPC:** Module 0's year-end close predates
CT's existence in this system and has its own decision log entry
(feature-spec.md #4) establishing DB-level one-time-per-year enforcement
for a *specific* purpose — transferring to Retained Earnings. Folding a
second, conceptually distinct posting (a tax provision, not a close)
into that RPC means every future change to either concern risks
regressing the other. This is the Build Order's own recommendation
(§7); this decision adopts it rather than re-litigating it, but leaves
it as an owner-confirmable item (§0.1) since the Build Order phrased it
as "likely the better fit," not a closed decision.

**Closed by G-32 (2026-09-18), re-read from live `schema.sql`:**

```
create_year_end_closing_entry(
  p_company_id  uuid,
  p_fiscal_year integer,
  p_created_by  uuid,
  p_entry_date  date default null,
  p_narration   text default null
) returns jsonb
```

Lock: `hashtext('ye:' || p_company_id || ':' || p_fiscal_year)`. Period
row: `accounting_periods` where `fiscal_year = p_fiscal_year`, `order by
period_end desc limit 1`. Tokens today: `YEAR_END_ALREADY_CLOSED`,
`NO_PERIOD_FOR_FISCAL_YEAR`, `RETAINED_EARNINGS_NOT_FOUND`,
`NO_PL_BALANCES_TO_CLOSE`. Return shape:

```
{ entry: journal_entries, lines: journal_lines[], attachments: [] }
```

Grants: `service_role` only, on `(uuid, integer, uuid, date, text)`.
Nest already calls those five named args
(`journal-entries.repository.supabase.ts`). G-22's
`CT_PROVISION_NOT_POSTED` check wires onto **this** function: two
trailing params with defaults (`p_skip_ct_check boolean default false`,
`p_skip_reason text default null`) so the existing five-arg Nest call
keeps working. GRANT/REVOKE must move to the seven-arg signature at
build. Skip requires a non-blank reason; persist it by prepending onto
`p_narration` (existing column — do not reshape `journal_entries`).

### G-2 — Taxable profit tracker reads the reporting core; it does not maintain a shadow ledger

**Decision:** the running profit-vs-375,000 tracker (deliverable #1)
is a read query over the same P&L data H1's `/profit-and-loss` route
already serves (Build Order §1), scoped to the current fiscal
year-to-date, plus the non-deductible-expense add-backs from G-5. It is
**not** a separately maintained running total updated on every journal
posting — the same "explicit RPC / read-query over ledger truth, not a
shadow calculation" discipline H1 itself established (Build Order §1:
"pure read-queries over what Module 1.1.A already has").

**Why not maintain a running balance column:** a running balance that
increments on every posting is a second source of truth that can drift
from the ledger (e.g. after a reversal); H1's Balance Sheet already
proved itself against reversals (TC12) and year-end close (TC11) by
staying a pure read-query. The threshold tracker should inherit that
same guarantee rather than reinvent a weaker one.

**Note — "taxable profit" vs. accounting profit:** the module request
says "profit," but UAE CT is levied on *taxable income*, which is
accounting net profit adjusted for specific add-backs and exclusions
(G-5's non-deductible items, exempt income, free-zone qualifying
income, and other adjustments UAE CT law defines that this pass does
not enumerate — §0.4). This decision names the tracker's output
`taxable_profit_estimate`, not `profit`, and documents in the API
response that it reflects only the adjustments this pass actually
implements (G-5's one named category plus free-zone exclusion from
G-6) — not a complete tax-return-grade taxable-income computation.
Overstating its completeness would be a worse failure mode than
under-scoping it.

### G-3 — CT Provision account: flagged, not invented

**Closed by G-13 (2026-09-18):** one control account, not a split
provision/payable pair — `Dr 5830 Cr 2300` for the full `ct_due`. No
separate "CT Payable" account exists in the finalized COA; `2300` is
both the provision credit and the payable balance, the same single-
control-account shape `2200` already took for VAT net payable (F-2/
F-20). Revise 3.5/3.1's schema accordingly (single
`provision_journal_entry_id`, no separate payable leg).

**Original decision (superseded by G-13, kept for record):** G-1's
provision RPC needs at minimum two GL accounts — a **CT Provision**
(P&L expense) account and a **CT Payable** (balance sheet liability)
account, following the same debit-expense / credit-liability shape a
tax provision always takes. Neither number was confirmed against the
finalized COA in this pass — same posture F-2 took for the
VAT-payable-to-FTA control account before F-20 closed it. ~~`[OPEN —
NEEDS COA VERIFICATION]`~~ **Closed by G-13: single account `2300`,
not a two-account pair — the "CT Payable" account this paragraph
proposed does not exist.**

**Why flag rather than guess (repeating F-2's own reasoning
verbatim in spirit):** posting a real tax provision against a guessed
account number would silently misstate a regulatory filing — a worse
failure mode than leaving the gap explicit.

### G-4 — Small Business Relief modeled as a versioned eligibility rule, not a hardcoded date

**Closed by G-17 / G-23 (2026-09-18):** sunset = tax periods **ending
on or before 31 December 2026** (not "commencing before," resolving
the ambiguity this entry flagged). Revenue cap AED 3,000,000 must hold
in the **current period and all prior periods**, not just the current
one — a company that exceeded 3m once is permanently out, so the
eligibility check reads a revenue history, not a single period's
figure. SBR is confirmed as an **election** — G-23 keeps this monitor-
only; the provision RPC never auto-applies it.

**Decision:** SBR eligibility (revenue below the module request's
AED 3,000,000 figure) is computed by an explicit
`check_small_business_relief_eligibility(company_id, fiscal_year)`
function reading from the same versioned rate/threshold table G-10
establishes for CT generally (mirrors F-23's `vat_tax_rule_versions`
pattern exactly) — not a hardcoded `if revenue < 3_000_000` check, and
not a hardcoded `if fiscal_year <= 2026` sunset check. The "valid until
Dec 2026" language in the module request is stored as a
`sbr_eligible_through` date on the versioned rule row, so if UAE
Cabinet/Ministerial guidance extends or changes it, correcting the
system is a data change (Part 5.1-style, per F's citation of that
pattern), not a code change.

**`[OPEN — NEEDS RULE VERIFICATION]` — Closed by G-17:** eligible for
tax periods **ending on or before 31 December 2026** (the "ending,"
not "commencing before," reading is confirmed).

**Also — Closed by G-23:** SBR is confirmed as a company-level
*election*, never auto-applied. This spec keeps it monitor-only per
G-23; no election-recording mechanism is built this pass.

### G-5 — Non-deductible expense adjustment: starts with the one account the COA already reserved

**Closed by G-18 / G-25 (2026-09-18):** entertainment (`5580`) is a
**50%** add-back, not 100% — the percentage this entry left open.
`5810` and `5930` are separate, newly-identified accounts that are
**100%** add-backs. G-25 confirms scope stays at exactly these three
accounts plus the two manual categories (qualifying dividends,
intragroup transactions) — no tax-loss carry-forward, interest cap,
unrealized G/L, or participation-exemption automation this pass.

**Decision:** the taxable-profit tracker (G-2) adds back exactly one
confirmed adjustment category in this pass: expenses posted to `5580`
Client Entertainment (Non-Deductible for CT) — an account F's own COA
research already confirmed exists and is already named for this
purpose. `qualifying_dividends` and `intragroup_transaction` exclusions
(the module request's named exempt-income categories) are modeled as a
`ct_income_adjustment` table — one row per journal line or invoice/
income line flagged as one of those two categories — subtracted from
taxable profit the same way `5580` is added back. Both directions
(add-backs and exclusions) flow through the same
`ct_income_adjustments` ledger-adjacent table so the taxable-profit
calculation has one place to look, not two.

**Why not build the full UAE CT adjustment list:** the module request
names exactly these categories (blocked entertainment implicitly via
the pre-existing COA account, qualifying dividends, intragroup
transactions). UAE CT law has substantially more adjustment types
(interest capping under Art. 30, unrealized FX/fair-value movements,
50%-not-100%-disallowed entertainment in some readings, etc.). Building
those without a named requirement or an Accounting Rules PDF section to
ground them would be inventing tax law, which this spec explicitly
declines to do (§0.4) — the taxable-profit tracker's output is
documented as a partial estimate (G-2), not a complete taxable-income
computation, specifically because of this gap.

**`[OPEN — NEEDS RULE VERIFICATION]` — Closed by G-18:** entertainment
is a **50%** add-back (not 100%, and not the "full balance" this
paragraph defaulted to) — `5580 × 50%` is the add-back amount, matching
the common "50% disallowed" treatment. `5810`/`5930` are separate,
newly-identified 100% add-back accounts not contemplated in this
original paragraph.

### G-6 — Free zone income classifier: entity-level QFZP flag plus line-level income tagging

**Closed by G-15 / G-16 / G-24 / G-30 (2026-09-18):** G-24 replaces the
new `ct_income_source` enum this entry proposed with reuse of COA
`4300`/`4310`/`4320` — no new column on `invoice_lines`. QFZP tax is
`(QI × 0%) + (NQI × 9%)` with **no** 375,000 zero-rate band (G-15) —
materially different from the standard-company formula, so the
provision RPC must branch on `is_free_zone_entity` rather than reusing
one formula for both. De-minimis threshold, left open here, is now
`MIN(5% of revenue, AED 5,000,000)` (G-16). G-30 keeps a de-minimis
breach as a flag only — never an automatic loss of the 0% rate.

**Original decision (superseded by G-24, kept for record):**
`companies.is_free_zone_entity` (confirmed to exist by F's Dependencies
section) is the entity-level starting gate — a company must be a
free-zone entity before any of its income can qualify at 0%. This
paragraph originally proposed a new `ct_income_source` enum tag
(`qualifying_free_zone` / `non_qualifying` / `mainland` /
`unclassified`) on invoice lines, with a periodic
`summarize_free_zone_income` roll-up. **Closed by G-24: no new
enum/column — the same roll-up instead reads the existing COA income
accounts (`4300`/`4310`/`4320`) directly.**

**Why line-level tagging, with a caveat (reasoning still holds, applied
to accounts instead of an enum):** mirrors F-1's reasoning (store the
classification explicitly at the point of entry, don't derive it) for
consistency with the one categorization pattern this codebase already
has. QFZP status itself is fundamentally an **entity-level, annual**
determination in UAE CT law — a set of conditions (adequate substance,
qualifying income thresholds, audited financial statements, etc.) that
line-level tagging alone cannot fully represent. Income-account tagging
feeds the return's income breakdown; it does **not** constitute a
system-enforced QFZP eligibility determination — that stays an
accountant judgment call, the same posture F-5 took for the Capital
Assets Scheme threshold, confirmed unchanged by G-30.

**`[OPEN — NEEDS RULE VERIFICATION]` — Closed by G-24:** the exact
"Qualifying Income" category list question is resolved by construction
— classification now lives in which COA income account (`4300`/`4310`/
`4320`) a line is posted to, set up when those accounts were defined,
rather than in an enum this spec would otherwise need to enumerate
sub-types for. No open category-list question remains for G to answer.

### G-7 — Related party transaction log: append-only, references existing entities, no pricing analysis

**Decision:** `related_party_transactions` — one row per transaction
between the company and a flagged related/connected person, storing
counterparty identity, relationship type, transaction type, amount, and
a reference back to the underlying journal entry or invoice/bill where
one exists. Append-only, same no-delete/reversal-only discipline as the
rest of the ledger (Module 0). This is a **documentation log**, not a
transfer-pricing engine — it does not compute arm's-length ranges,
flag under/over-pricing, or generate a Local File / Master File. It
exists to give the CT return summary (§4.8) something to export and to
give an auditor a starting register, matching how F-15's audit pack is
an aggregation of existing data, not a new analysis capability.

**`[OPEN]` — Closed by G-26:** confirmed the log's own free-text
`counterparty_name` field, not a reuse of `customers`/`suppliers` — a
related party is not necessarily an existing commercial counterparty
(could be a shareholder, director, or group company with no invoices/
bills at all), so requiring a customer/supplier record would wrongly
block logging those. `reference_journal_entry_id` stays optional for
exactly this reason.

### G-8 — CT return preparation summary: same export-shape split F-9 established

**Decision:** G owns the FTA-specific *data shape* for a CT return
summary (taxable income build-up, SBR determination, free-zone income
split, related-party disclosure summary, tax due) via a
`prepare_ct_return_summary(company_id, fiscal_year)` function, the same
way F-9 said "F owns the FTA export shape; H-remainder owns generic
export [rendering mechanics]." PDF/XLSX rendering of that structured
data is out of scope for this pass (§7), matching F's own split.

**Why the same split:** re-litigating export-format ownership per
module would be exactly the kind of parallel-path proliferation E-12/
E-13 and F-3 both explicitly declined elsewhere in this codebase.

### G-9 — CT payment due date: a column, not a reminder engine

**Closed by G-19 (2026-09-18):** due date = the last FY `period_end` +
9 months, e.g. 31 Dec 2025 → 30 Sep 2026 — confirms `period_end` (not
provision-post date, not calendar year end) is the anchor.

**Decision:** `ct_provision_entries` gets a `payment_due_date` column,
computed as the fiscal year's `period_end` plus 9 months, written when
the provision is posted (mirrors F-21/F-11's exact pattern: F-11
"stores the due date, no reminder engine"). No new notification/
reminder infrastructure is built in this pass — a live reminder engine
was explicitly deferred by F-11 and this spec does not reopen that
scope for G.

### G-10 — Versioned CT rate/threshold table

**Decision:** `ct_tax_rule_versions` — one row per effective period,
storing the 0%/9% rate structure, the AED 375,000 threshold, the
AED 3,000,000 SBR revenue cap and its `sbr_eligible_through` date
(G-4), and the QFZP 0% rate — mirroring `vat_tax_rule_versions`
(F-23) field-for-field in spirit. No CT rate, threshold, or cap is
hardcoded in any RPC; every one is a lookup against this table's
currently-effective row, exactly as F-23 required for VAT.

**Why:** UAE CT rates and thresholds are set by Cabinet Decision, not
primary legislation, and F-23's own reasoning ("tax logic must update
without redeploying core code") applies at least as strongly here,
since CT is a newer regime than VAT and more likely to see near-term
threshold adjustments (SBR's own sunset date is the clearest example
already visible in the module request itself).

### G-11 — CT registration status readout, not a registration-threshold trigger

**Decision:** a read-only `ct_registration_status` readout (mirrors
F-32's registration-threshold readout in *shape* only) surfaces whether
the company has recorded a CT registration — TRN-equivalent for CT,
confirmed by G-20 to be the **same** `companies.trn` field VAT uses,
not a separate CT-specific identifier — because CT registration in the
UAE is required for essentially all taxable persons regardless of
profit level — unlike VAT, there is no meaningful "below-threshold, not
yet required to register" state for CT to monitor. This decision exists
specifically to head off copy-pasting F-32's revenue-threshold logic
into a context where the underlying rule is completely different.

### G-12 — CT penalty-exposure warning: compute and warn, never auto-post

**Decision:** mirrors F-28 exactly — a `check_ct_penalty_exposure`
read query surfaces late-filing/late-payment exposure once
`payment_due_date` (G-9) has passed without a recorded filing/payment,
displayed as a warning. No automatic penalty-accrual journal entry is
posted. If a future pass wants an optional accrual (the same "optional
accrue to `5810`/`2230`" F-28 allowed for VAT), that is a follow-up
decision, not assumed here, and would need its own COA verification
(G-3's same posture).

### G-13 — Provision JE: single control account, not a provision/payable split

**Decision:** `Dr 5830 (CT Provision, P&L) / Cr 2300 (CT control)` for
`ct_due`. One account carries both the accrued liability and the
payable balance — no separate "CT Payable" account exists in the COA.
Settlement at payment (out of scope for posting mechanics this pass,
per §7) would debit `2300` against cash, the same shape `2200`/`1020`
takes for VAT (F-30).

### G-14 — Year-end RPC signature and CT's place in it

**Decision:** `create_year_end_closing_entry` keeps its existing
five-argument signature (quoted under G-1 / G-32), `ye:` lock
namespace, and `YEAR_END_ALREADY_CLOSED` token. It zeros **all** P&L
accounts including `5830` into `3100` (Retained Earnings), same as any
other expense account. This is exactly why G-1's "after YE" framing
was wrong and G-22 corrects the sequencing. G-22 is an **additive**
pre-check plus two defaulted params — not a replacement RPC.

### G-15 — CT rate structure: standard bands vs. QFZP formula are two different calculations

**Decision:** standard (non-free-zone) companies: 0% on the first AED
375,000 of taxable profit, 9% above it. QFZP companies: `(Qualifying
Income × 0%) + (Non-Qualifying Income × 9%)` — **no** 375,000 band at
all; every dirham of non-qualifying income is taxed at 9% from the
first dirham. `create_ct_provision_entry` (G-1) branches on
`companies.is_free_zone_entity` and computes with a different formula
per branch, not one formula with a conditional threshold.

**Why this matters enough to call out as its own decision:** treating
QFZP as "the same formula, just with a free-zone exemption layered on
top" would silently apply a 375,000 zero-rate band QFZP companies do
not get under UAE CT law, understating their liability on
non-qualifying income under 375k.

### G-16 — QFZP de-minimis threshold

**Decision:** `MIN(5% of the entity's total revenue, AED 5,000,000)`
for the period. `summarize_free_zone_income` (§4.6) computes
non-qualifying income against this cap and flags (per G-30) when it's
exceeded; it does not change the 0% rate applied to qualifying income
itself.

### G-17 — SBR sunset and revenue-cap mechanics

**Decision:** eligible for tax periods **ending on or before 31
December 2026**. Revenue cap AED 3,000,000 applies to the current
period **and every prior period** — a company that ever exceeded 3m is
permanently ineligible going forward, not just in the year it
exceeded. `check_small_business_relief_eligibility` therefore needs a
revenue history lookup across all prior fiscal years for the company,
not a single-period query.

### G-18 — Non-deductible add-back rates

**Decision:** `5580` (entertainment) — 50% of its balance is added
back. `5810` and `5930` — 100% added back each. All three feed
`ct_income_adjustments` as `non_deductible_expense` rows at the
confirmed percentage; the percentage is stored per account mapping
(not hardcoded per RPC call), so a future rate change is a data
change, consistent with G-10's versioning philosophy.

### G-19 — Payment due date anchor

**Decision:** last fiscal year `period_end` + 9 months (confirms
`period_end`, not the provision-post date or a calendar year end, is
the anchor — resolves what G-9 left as the informal "FY end").

### G-20 — Registration readout field

**Decision:** `companies.trn` is the field G-11's readout surfaces.
UAE practice uses a single TRN across VAT and CT registration for a
given entity; no separate CT-specific identifier column is added.

### G-21 — Route shape matches F, not a nested-resource pattern

**Decision:** Nest routes take `company_id` on the request body/query,
the same convention F's VAT routes use — **not** `/companies/:id/ct/...`
as §5 sketched. §5 is corrected below.

### G-22 — Provision-before-YE, enforced

**Decision:** `create_ct_provision_entry` posts into the fiscal year's
last open accounting period, before `create_year_end_closing_entry`
runs for that year. `create_year_end_closing_entry` is extended with a
check: if no `ct_provision_entries` row with `status = 'posted'` exists
for the fiscal year being closed, it raises `CT_PROVISION_NOT_POSTED`
unless called with an explicit `skip_ct_check: true` and a required
`skip_reason` — mirrors E-25's override-with-reason pattern for a
failed three-way match, rather than a silent skip or an unenforced
recommendation.

**Why enforce rather than just document the order:** every other
one-time-per-period rule in this codebase (VAT's post-filing lock,
Module 0's year-end token, E's approval-threshold gate) is a DB-level
check, not a documented convention accountants are trusted to follow
in the right order. A silently-wrong-year CT provision is a worse
failure mode than a blocked YE close with a clear error code.

### G-23 — SBR stays monitor-only

**Decision:** no election-recording table this pass. `create_
ct_provision_entry` always computes `ct_due` from the 0%/9% (or QFZP)
bands; SBR eligibility is surfaced via `check_small_business_relief_
eligibility` as information only, per the module request's own
"monitor" wording. An election mechanism, if wanted later, is a
follow-up decision, not implied by this one.

### G-24 — Free-zone tagging reuses income accounts, no new column

**Decision:** removes `invoice_lines.ct_income_source` from §3.2.
`summarize_free_zone_income` reads `invoice_lines.income_account_id`
against `4300`/`4310`/`4320` directly. Entity gate stays
`companies.is_free_zone_entity`; QFZP status stays an accountant
judgment call (unchanged from G-6's original posture).

### G-25 — Adjustment list closed at three accounts plus two manual categories

**Decision:** confirms scope: `5580` (50%), `5810` (100%), `5930`
(100%) as automated add-backs; `qualifying_dividend` and
`intragroup_transaction` as manual `ct_income_adjustments` rows. No
tax-loss carry-forward, no interest-deduction cap, no unrealized FX/
fair-value adjustment, no participation-exemption automation. The
tracker's output stays `taxable_profit_estimate`, documented as
partial.

### G-26 — Related-party log stays a standalone table

**Decision:** confirms `related_party_transactions` as designed in
G-7 — no reuse of a customer/supplier relationship flag (none exists
on those tables in `schema.sql`), no posting against `1150` Related
Party Receivables or `2030` Related Party Payables. Both accounts exist
and are **active** on the demo COA (IAS 24); this module does not
touch them.

### G-27 — Role gate: Accountant drafts, Owner posts

**Decision:** `POST /ct/provisions/calculate` (draft, non-posting) is
Accountant-or-Owner. `POST /ct/provisions/:fiscal_year/post` (the
actual `create_ct_provision_entry` call) is Owner-only. Mirrors F-8's
"no new roles" posture exactly — reuses the existing Owner/Accountant
distinction.

### G-28 — Deferred tax (IAS 12) out of scope

**Decision:** `1900` Deferred Tax Asset and `2310` Deferred Tax
Liability exist on the demo COA as **inactive** detail accounts. This
module does not activate or post to them. PDF §3.15 scopes this module
to current tax only. Deferred tax is a distinct project with its own
recognition/measurement rules, not a natural extension of G.

### G-29 — VAT–CT cross-check deferred

**Decision:** PDF Part 5.5's inconsistency report (e.g. revenue
reported to FTA via VAT 201 vs. via the CT return) is not built in
this pass. Candidate for a follow-up module or H-remainder, since it
reads across F's and G's data without belonging structurally to
either.

### G-30 — QFZP de-minimis breach: flag only

**Decision:** confirms G-6's original posture — `summarize_free_zone_
income` surfaces a breach of G-16's threshold as a flag on the
period's summary. It never changes `ct_income_source`-equivalent
(now: income-account-based) classification or strips the 0% rate from
already-posted qualifying income. Losing QFZP status is a legal
determination Article-conditioned on more than revenue alone (adequate
substance, audited financials, etc.) — outside what this system can
or should adjudicate.

### G-31 — Natural persons and tax groups out of scope

**Decision:** confirmed out of scope. The tenant model is `companies`
only; UAE CT's separate treatment of natural persons conducting
business (PDF §2.4) and of tax groups (multiple companies filing as
one taxable person) are both structurally different from a single-
company provision/return flow and are not modeled here.

### G-32 — Live YE signature and adjustment source FKs (2026-09-18)

**Closes G-1's remaining schema-verification flag, and §3.4's
`source_reference` text.**

**1. `create_year_end_closing_entry` — live `schema.sql` (lines
10569–10739) and Nest `createYearEndClosingEntry`.** Signature,
lock, tokens, return jsonb, and grants are quoted under G-1 above.
This is the function G-22 extends. Do not invent a second YE RPC.

At G build, `CREATE OR REPLACE` adds:

```
p_skip_ct_check boolean default false,
p_skip_reason   text default null
```

After the lock, before P&L aggregation: if no `ct_provision_entries`
row with `status = 'posted'` for `(p_company_id, p_fiscal_year)` and
`p_skip_ct_check` is not true, `raise exception 'CT_PROVISION_NOT_POSTED'`.
Skip requires `btrim(p_skip_reason) <> ''` (E-25 analogue). Prepend
the reason onto `v_narration`. Re-issue GRANT/REVOKE on
`(uuid, integer, uuid, date, text, boolean, text)`. Map the new token
in `JournalEntriesService.throwMappedJournalRpcError` the same way
`YEAR_END_ALREADY_CLOSED` is mapped today. Nest DTO gains optional
`skip_ct_check` / `skip_reason`; Owner-only to skip (E-25).

**2. `ct_income_adjustments` sources — live convention is
`vat_return_line_item_sources` (`schema.sql` ~6947): typed nullable
FKs + XOR check `= 1`. There is no polymorphic `text` source column
anywhere in this schema.** Drop `source_reference text`. Use:

```
invoice_line_id   uuid references invoice_lines(id),
journal_line_id   uuid references journal_lines(id),
journal_entry_id  uuid references journal_entries(id),
constraint ct_income_adjustments_source_xor check (
  (
    adjustment_type in ('qualifying_dividend', 'intragroup_transaction')
    and (invoice_line_id is not null)::int
      + (journal_line_id is not null)::int
      + (journal_entry_id is not null)::int = 1
  )
  or (
    adjustment_type in ('non_deductible_entertainment', 'non_deductible_other')
    and invoice_line_id is null
    and journal_line_id is null
    and journal_entry_id is null
  )
)
```

Manual rows (G-25) = exactly one source FK, same XOR as VAT drill-down.
Automated add-backs (G-18) are account-level GL aggregates, so all
three FKs stay null — they are not line-sourced.

---

## 3. Schema (additive — grounded against G-13…G-32; fold into `schema.sql` at build; no `apply_*.sql`)

All new tables: `company_id` where tenant-owned, RLS
`company_isolation_*` via `app.current_company_id`, grants to
`service_role` only — same posture F §3 opened with. Money
`numeric(18,2)`. **Verified against live `schema.sql` (G-32):** no
`ct_*` tables today; YE signature is the five-arg function above;
source FKs follow `vat_return_line_item_sources`.

### 3.1 Enums

```
create type ct_income_adjustment_type as enum (
  'qualifying_dividend', 'intragroup_transaction',
  'non_deductible_entertainment', 'non_deductible_other'
);
create type ct_provision_status as enum (
  'draft', 'posted', 'superseded'
);
create type related_party_relationship as enum (
  'shareholder', 'director', 'group_company', 'other_connected_person'
);
```

`journal_entry_type` gains `ct_provision` (additive, per the module
request's own framing — mirrors F-24's approach for F-owned posting
types).

### 3.2 Additive columns on existing tables

None on `invoice_lines` — G-24 closes G-6's original `ct_income_source`
proposal by reusing COA `4300`/`4310`/`4320` instead of adding a
column. No new column on `companies` — `is_free_zone_entity` and `trn`
already exist (`schema.sql` companies table; G-20).

### 3.3 `ct_tax_rule_versions` (G-10, formula fields per G-15/G-16/G-17/G-18)

```
id                          uuid pk
effective_from              date not null
standard_rate               numeric(5,2) not null           -- 9.00
zero_rate_threshold         numeric(18,2) not null           -- 375000, standard companies only (G-15)
qfzp_rate                   numeric(5,2) not null            -- 0.00, on qualifying income, no threshold band (G-15)
qfzp_deminimis_pct          numeric(5,2) not null default 5  -- 5% of revenue (G-16)
qfzp_deminimis_cap          numeric(18,2) not null           -- 5000000 (G-16)
sbr_revenue_cap             numeric(18,2) not null           -- 3000000, current + all prior periods (G-17)
sbr_eligible_through        date not null                    -- 2026-12-31, period end basis (G-17)
entertainment_addback_pct   numeric(5,2) not null default 50 -- 5580 (G-18)
other_addback_accounts      text[] not null default '{5810,5930}' -- 100% addback (G-18)
alert_threshold_pct         numeric(5,2) not null default 90 -- deliverable #2, configurable
```

### 3.4 `ct_income_adjustments` (G-5 / G-18 / G-25)

```
id                    uuid pk
company_id            uuid not null references companies(id)
fiscal_year           int not null
adjustment_type       ct_income_adjustment_type not null
amount                numeric(18,2) not null          -- already at the applicable pct (50% for entertainment)
invoice_line_id       uuid references invoice_lines(id)    -- G-32; XOR with the two below
journal_line_id       uuid references journal_lines(id)
journal_entry_id      uuid references journal_entries(id)
recorded_at           timestamptz not null default now()
recorded_by           uuid                    -- manual rows only (dividends/intragroup); automated rows null
-- constraint ct_income_adjustments_source_xor: quoted in G-32
```

### 3.5 `ct_provision_entries` (G-1 / G-13 / G-19 / G-22)

```
id                          uuid pk
company_id                  uuid not null references companies(id)
fiscal_year                 int not null
taxable_profit_estimate     numeric(18,2) not null   -- G-2
is_qfzp_calculation         boolean not null default false  -- G-15 formula branch
sbr_eligible                boolean not null default false  -- readout only, G-23
ct_due                      numeric(18,2) not null
payment_due_date            date not null            -- G-19, FY period_end + 9 months
status                      ct_provision_status not null default 'draft'
provision_journal_entry_id  uuid references journal_entries(id)  -- Dr 5830 Cr 2300 (G-13)
posted_at                   timestamptz
posted_by                   uuid                     -- Owner only (G-27)
unique (company_id, fiscal_year)
```

### 3.6 `related_party_transactions` (G-7 / G-26)

```
id                    uuid pk
company_id            uuid not null references companies(id)
counterparty_name     text not null
relationship          related_party_relationship not null
transaction_type      text not null
amount                numeric(18,2) not null
transaction_date      date not null
reference_journal_entry_id uuid references journal_entries(id)
notes                 text
created_at            timestamptz not null default now()
```

---

## 4. Business rules

### 4.1 Taxable profit tracker (G-2)

`get_ct_taxable_profit_estimate(company_id, fiscal_year)`: fiscal
year-to-date net profit from the reporting core, **plus**
non-deductible add-backs (50% of `5580`, 100% of `5810`/`5930` — G-18),
**minus** exempt-income exclusions (`ct_income_adjustments` where type
is `qualifying_dividend` or `intragroup_transaction`), **minus**
qualifying free-zone income (via `4300`/`4310`/`4320` — G-24), read
live — not cached — the same way H1's reports read live.

### 4.2 Threshold alert (deliverable #2)

Configurable percentage (`alert_threshold_pct` on G-10's rule table,
default 90 → AED 330,000 at the current 375,000 threshold) triggers a
flag on the same read query, not a push notification — no notification
infrastructure exists in this pass (mirrors F-11/G-9's stance).
Front-end/consuming layer decides how to surface the flag.

### 4.3 CT provision posting (G-1/G-3)

`create_ct_provision_entry(company_id, fiscal_year)`: reads G-10's
current rule row. If `is_free_zone_entity`: `ct_due = (qualifying_income
× 0) + (non_qualifying_income × qfzp_rate)` — no threshold band (G-15).
Otherwise: `ct_due = max(0, taxable_profit_estimate −
zero_rate_threshold) × standard_rate`. SBR (G-23) is monitor-only and
never zeroes `ct_due` automatically — `sbr_eligible` is stored on the
row as a readout, not applied. Posts `Dr 5830 Cr 2300` (G-13) for
`ct_due`, into the fiscal year's **last open accounting period** (G-22)
— must run before `create_year_end_closing_entry` for the same year, or
that RPC raises `CT_PROVISION_NOT_POSTED` (G-22). One row per
`(company_id, fiscal_year)` — a second call for an already-`posted` row
raises `CT_PROVISION_ALREADY_POSTED`. Posting itself is Owner-only
(G-27); an Accountant may call a separate calculate/draft path that
computes but does not post.

### 4.4 Small Business Relief monitor (G-4)

`check_small_business_relief_eligibility(company_id, fiscal_year)`:
checks the fiscal year's `period_end` against `sbr_eligible_through`
(2026-12-31 — period-*ending* basis, G-17), and compares revenue
against `sbr_revenue_cap` for the current fiscal year **and every
prior fiscal year on record for the company** (G-17 — the cap is
cumulative, not single-period). Returns eligibility plus the rule
version used — informational only; never silently applied to G-1's
posting (G-23).

### 4.5 Exempt income / non-deductible expenses (G-5)

Recorded via `ct_income_adjustments` inserts, two ways per G-25 / G-32:
`non_deductible_entertainment`/`non_deductible_other` rows (`5580` at
50%, `5810`/`5930` at 100%) are **automated** — computed from those
accounts' period balances, `recorded_by` null, all source FKs null.
`qualifying_dividend`/`intragroup_transaction` rows are **manual** —
exactly one of `invoice_line_id` / `journal_line_id` /
`journal_entry_id` (XOR, same as `vat_return_line_item_sources`),
`recorded_by` set. No `source_reference text`. No automated rule infers
dividends or intragroup from an account mapping (G-25).

### 4.6 Free zone income classifier (G-6)

`summarize_free_zone_income(company_id, fiscal_year)`: aggregates
income by `invoice_lines.income_account_id` against COA `4300`
(qualifying) / `4310` / `4320` (G-24) for free-zone entities only
(`companies.is_free_zone_entity = true`); non-free-zone companies get
no qualifying-income calculation (not applicable). Flags — never
gates — when non-qualifying income exceeds `MIN(5% of revenue, AED
5,000,000)` (G-16). A breach never strips the 0% rate already applied
to qualifying income (G-30) — QFZP status loss is a legal
determination this system does not adjudicate.

### 4.7 Related party transaction log (G-7)

Insert-only via `record_related_party_transaction(...)`. No update/
delete RPC — corrections are a new row with a note, same reversal-only
posture as the rest of the ledger.

### 4.8 CT return preparation summary (G-8)

`prepare_ct_return_summary(company_id, fiscal_year)` aggregates G-1's
provision row, G-4's SBR determination, G-6's free-zone split, and a
count/total from G-7's related-party log into one structured object.
Export/rendering mechanics: out of scope (§7).

### 4.9 CT payment due date (G-9)

Computed once, at `create_ct_provision_entry` time, as the FY's last
`accounting_periods.period_end` + 9 months (G-19). Stored on
`ct_provision_entries.payment_due_date`. No reminder engine (§7).

### 4.10 CT registration status readout (G-11)

Read-only; surfaces `companies.trn` (G-20).

### 4.11 CT penalty-exposure warning (G-12)

`check_ct_penalty_exposure(company_id, fiscal_year)`: warns once a
**posted** provision's `payment_due_date` is before `current_date`
(G-12 / G-32). No auto-posted penalty accrual. No filing/payment
marker columns this pass.

---

## 5. API (G-21 route shape; G-27 role gates)

`company_id` on body/query, matching F's VAT routes — not a nested
`/companies/:id/ct` resource (G-21):

```
GET  /ct/taxable-profit?company_id=&fiscal_year=          (G-2/§4.1, §4.2 alert flag inline) — Owner/Accountant
POST /ct/provisions/calculate                              (draft/preview, G-27) — Owner/Accountant
POST /ct/provisions/post                                    (actually posts, G-1/G-13/G-22) — Owner only
GET  /ct/provisions?company_id=&fiscal_year=
GET  /ct/sbr-eligibility?company_id=&fiscal_year=           (§4.4/G-17) — Owner/Accountant
POST /ct/income-adjustments                                  (§4.5/G-25, manual rows only) — Owner/Accountant
GET  /ct/free-zone-summary?company_id=&fiscal_year=          (§4.6/G-16/G-24) — Owner/Accountant
POST /ct/related-party-transactions                           (§4.7/G-26) — Owner/Accountant
GET  /ct/related-party-transactions?company_id=
GET  /ct/return-summary?company_id=&fiscal_year=               (§4.8) — Owner/Accountant
GET  /ct/registration-status?company_id=                        (§4.10/G-20, reads companies.trn) — Owner/Accountant
GET  /ct/penalty-exposure?company_id=&fiscal_year=                (§4.11) — Owner/Accountant
```

---

## 6. Relationship to existing schema

G reads but does not modify: `companies` (`is_free_zone_entity`,
`trn`), the reporting core's P&L (H-core), `journal_entries` /
`journal_lines` (for `5580`/`5810`/`5930`/`4300`/`4310`/`4320`/`5830`/
`2300`), `accounting_periods` (FY bounds and YE last-period pick),
`invoice_lines.income_account_id` (G-24). G does not touch VAT's
tables — the relationship to F is a *pattern* precedent only, not a
schema coupling.

G adds **no** column on `invoice_lines` (G-24 / G-32). C's
`income_account_id` and F's `vat_category`/`emirate` stay as they are.

---

## 7. Out of scope for this pass

- **Actual FTA portal submission or FTA API filing** — mirrors F-9/F-10.
- **Actual CT return filing** — preparation only (§4.8/G-8).
- **The full UAE CT taxable-income adjustment list** beyond G-25
  (`5580`@50%, `5810`/`5930`@100%, plus manual dividends/intragroup).
- **Transfer-pricing arm's-length analysis, Local File / Master File
  generation** — G-7 is a transaction log only.
- **A live payment-reminder/notification engine** — mirrors F-11/G-9.
- **Multi-entity UAE tax-group consolidation.**
- **Auto-posting CT penalties** — G-12 warn only, mirrors F-28.
- **PDF/XLSX/CSV rendering mechanics generally** — H-remainder, mirrors
  F-9's split.
- **SBR election recording** — G-4 monitors eligibility; does not
  record or enforce an election.
- **QFZP eligibility determination as a system-enforced gate** — G-24/
  G-30: income tagged via existing income accounts; entity-level QFZP
  status, and any de-minimis breach, stay an accountant judgment call,
  mirrors F-5's Capital Assets Scheme posture.
- **CT-specific registration workflow/UI** — G-11/G-20 is a readout
  only, off `companies.trn`.
- **Deferred tax (IAS 12)** — G-28. `1900`/`2310`, if present, are not
  touched by this module.
- **VAT–CT cross-check / inconsistency report** — G-29, PDF Part 5.5.
  Candidate for a later pass or H-remainder.
- **Natural persons and tax groups** — G-31. Tenant model is
  `companies` only.
- **SBR election recording** — G-23. Monitor only; no election table.

---

## 8. Build status / sign-off

**Module 1.1.G spec is ratified (2026-09-18); nothing is implemented
yet.** G-1…G-12 (first draft) → G-13…G-21 (schema/COA/PDF grounding) →
G-22…G-31 (owner decisions) → G-32 (live YE signature + typed
adjustment FKs).

### Closed

1. Provision posting: `Dr 5830 Cr 2300`, single control account (G-13).
2. Sequencing: provision before YE, enforced via `CT_PROVISION_NOT_POSTED`
   on the live five-arg `create_year_end_closing_entry` (G-14/G-22/G-32).
3. Rate formulas: standard 0%/9% band vs. QFZP `(QI×0)+(NQI×9%)`, no
   band for QFZP (G-15).
4. QFZP de-minimis `MIN(5%, AED 5m)` (G-16).
5. SBR: period-end-based sunset, cumulative revenue cap, election
   stays monitor-only (G-17/G-23).
6. Add-back rates: `5580` 50%, `5810`/`5930` 100% (G-18).
7. Due date anchor: `period_end` + 9 months (G-19).
8. Registration readout: `companies.trn` (G-20).
9. Route shape matches F's convention (G-21).
10. Role gate: Accountant drafts, Owner posts (G-27).
11. Scope closed at: three add-back accounts + two manual adjustment
    categories (G-25); standalone related-party log (G-26); deferred
    tax, VAT–CT cross-check, natural persons/tax groups all out (G-28/
    G-29/G-31); de-minimis breach flag-only (G-30).

### No open spec residuals

Unlike F (which shipped with two post-ratification residuals — the VD
threshold and the Box 2/CAS screenshot), G's grounding pass had all
three source documents in hand before the owner round, so no
`[OPEN — NEEDS VERIFICATION]` flags remain in §2.

### Before implementation starts (build tasks, not spec questions)

1. Additive DDL in `schema.sql` (no `apply_*.sql`): §3 tables/enums,
   `ALTER TYPE journal_entry_type ADD VALUE 'ct_provision'` in its own
   statement, G-32 skip params on `create_year_end_closing_entry` plus
   GRANT/REVOKE on the seven-arg signature.
2. Nest: map `CT_PROVISION_NOT_POSTED` next to `YEAR_END_ALREADY_CLOSED`;
   optional Owner-only `skip_ct_check` / `skip_reason` on the YE DTO.
3. Dependency status: Module 0 (A) ✅, Module 1 (H-core) ✅, Module 6
   (F) ✅. G is next in Build Order sequence.

### Not yet started

No DDL is folded into `schema.sql`, no RPCs exist, no routes exist, no
tests exist. §3–§5 are ratified design, not code.

---

## 9. Decision Log Index

| # | Summary | Detail in |
|---|---|---|
| G-1 | Dedicated `create_ct_provision_entry` RPC, `ct:` lock; YE order closed by G-22; live signature G-32 | §2 G-1, G-22, G-32 |
| G-2 | Taxable profit tracker reads reporting core live; named `taxable_profit_estimate` | §2 G-2 |
| G-3 | CT accounts flagged, not invented — closed by G-13 (`Dr 5830 Cr 2300`) | §2 G-3, G-13 |
| G-4 | SBR via versioned rule; sunset closed by G-17; election closed by G-23 | §2 G-4, G-17, G-23 |
| G-5 | `5580` add-back; dividends/intragroup manual; percentage closed by G-18 (50%) | §2 G-5, G-18 |
| G-6 | FZ classifier; tagging closed by G-24 (`4300`/`4310`/`4320`); de-minimis G-16/G-30 | §2 G-6, G-16, G-24, G-30 |
| G-7 | Related-party log: append-only, documentation only, no pricing analysis | §2 G-7 |
| G-8 | CT return summary: G owns FTA data shape, H-remainder owns rendering (mirrors F-9) | §2 G-8 |
| G-9 | Payment due date = FY end + 9 months, column only, no reminder engine (mirrors F-11) | §2 G-9 |
| G-10 | Versioned `ct_tax_rule_versions` table; no hardcoded rates/thresholds (mirrors F-23) | §2 G-10 |
| G-11 | CT registration readout, not a threshold trigger (CT registration is near-universal, unlike VAT) | §2 G-11 |
| G-12 | CT penalty-exposure warning only, no auto-accrual (mirrors F-28) | §2 G-12 |
| G-13 | Provision JE: `Dr 5830 Cr 2300`, single control account | §2 G-13 |
| G-14 | YE RPC unchanged; zeros `5830` into `3100` with rest of P&L | §2 G-14 |
| G-15 | Standard 0%/9% band vs. QFZP `(QI×0)+(NQI×9%)`, no band for QFZP | §2 G-15 |
| G-16 | QFZP de-minimis = `MIN(5% revenue, AED 5,000,000)` | §2 G-16 |
| G-17 | SBR: sunset = periods ending ≤ 31 Dec 2026; revenue cap cumulative across all prior periods | §2 G-17 |
| G-18 | Add-backs: `5580` 50%, `5810`/`5930` 100% | §2 G-18 |
| G-19 | Due date = last FY `period_end` + 9 months | §2 G-19 |
| G-20 | Registration readout = `companies.trn` | §2 G-20 |
| G-21 | Routes take `company_id` on body/query, matching F | §2 G-21 |
| G-22 | Provision posts before YE; YE refuses to close without it (`CT_PROVISION_NOT_POSTED`), override with reason | §2 G-22 |
| G-23 | SBR stays monitor-only; no election table | §2 G-23 |
| G-24 | Free-zone tagging reuses `4300`/`4310`/`4320`; no new column | §2 G-24 |
| G-25 | Adjustment scope closed: 3 accounts + 2 manual categories | §2 G-25 |
| G-26 | Related-party log stands alone; no account reuse | §2 G-26 |
| G-27 | Accountant drafts/calculates; Owner posts | §2 G-27 |
| G-28 | Deferred tax (IAS 12) out of scope | §2 G-28 |
| G-29 | VAT–CT cross-check deferred | §2 G-29 |
| G-30 | QFZP de-minimis breach: flag only, never auto-strips 0% | §2 G-30 |
| G-31 | Natural persons / tax groups out of scope | §2 G-31 |
| G-32 | Live YE signature `(uuid, integer, uuid, date, text) → jsonb`; drop `source_reference`; XOR FKs like `vat_return_line_item_sources` | §2 G-32 |