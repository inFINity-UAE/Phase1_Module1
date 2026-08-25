# Module 1.1.A — Double-Entry Accounting Engine
## Feature Specification (Source of Truth)

Part of Module 1.1 · AI-Based Accounting Foundation, inFINity Phase 1 (MVP).
This is the authoritative feature list for Module 1.1.A only — do not infer
scope from Module 1.1.B–H or later phases.

## Account numbering scheme (AUTHORITATIVE — supersedes any other document)

4-digit account numbering, 5 bands:

| Prefix | Category   | schema.sql `account_category` enum value |
|--------|-----------|-------------------------------------------|
| 1000s  | Assets     | `asset`                                    |
| 2000s  | Liabilities| `liability`                                |
| 3000s  | Equity     | `equity`                                   |
| 4000s  | Income     | `income`                                   |
| 5000s  | Expenses   | `expense`                                  |

There is no separate leading-digit band for COGS. Cost of Goods Sold
accounts are `category = 'expense'`, numbered in the 5000s, distinguished
only by `sub_category` (e.g. `sub_category = 'COGS'`). This is a 5-band
scheme, not 6 — it supersedes the 6-band structure (Asset/Liability/Equity/
Revenue/Expense/COGS) found in `Chart_of_Accounts_-_inFINity.xlsx`, which is
a generic template used only for its column structure, not its category
scheme or content.

## Features

- Complete general ledger with double-entry debit/credit posting and
  imbalance rejection
- UAE-standard pre-built chart of accounts — Assets, Liabilities, Equity,
  Income, Expenses
- 80+ default accounts including UAE-specific: VAT Payable, VAT Receivable,
  CT Provision, Import Duty, Zakat Reserve, Free Zone Income
- Custom account creation with sub-account hierarchy up to 4 levels deep
- 4-digit account numbering: 1000s=Assets, 2000s=Liabilities, 3000s=Equity,
  4000s=Income, 5000s=Expenses
- Account locking: accounts with transaction history deactivated, not
  deleted — protects historical accuracy
- Manual journal entry with narration, reference number, and document
  attachment
- Recurring journal entries: depreciation, prepaid amortisation, accruals —
  set frequency and auto-post
- Journal approval workflow: Owner must approve entries above a
  configurable AED threshold
- Period soft-close with override permission for corrections by authorised
  users
- Year-end closing: auto-transfer of P&L balances to retained earnings
  account
- Reversing journal entries: one-click reversal in the next period
- Opening balance entry: historical import for companies setting up
  mid-year
- Immutable audit trail: all entries logged — reversals only, no deletions
  ever

## Product decisions (resolving gaps not covered by the Accounting Rules PDF)

Logged 2026-08-21, apply as hard rules — do not treat these as open
questions in later stages:

1. **Owner role bypasses the approval workflow entirely**, regardless of
   entry amount or who created the entry — including approving/posting
   their own entries. The Owner is treated as the ultimate accountable
   party. The `pending_approval → approve` flow applies only when the
   original poster is NOT an Owner.
2. **An entry cannot be reversed twice.** Once reversed, a journal entry's
   status becomes `reversed` (schema.sql enum value) and it is locked from
   being reversed again — a second reversal would double-count the
   correction and unbalance the ledger.
3. **Opening balances are one-time per company per fiscal year**, not an
   additive/repeatable action. A second `opening_balance` entry for the
   same company + fiscal year must be rejected; corrections go through a
   manual adjusting/reversing entry instead.
4. **Year-end closing is one-time per company per fiscal year.** It posts
   real entries transferring P&L into Retained Earnings — running it twice
   would double-transfer. A second `year_end_closing` entry for the same
   company + fiscal year must be rejected outright, with no partial
   cleanup attempted.

5. **`normal_balance` values are the exact enum literals `debit` / `credit`**
   (lowercase), per `schema.sql`'s `normal_balance_type` enum. No other
   casing or synonyms.
6. **The COA seed script creates a fixed-UUID demo company** —
   `00000000-0000-0000-0000-000000000001`, name `'Demo Company (Seed)'` —
   rather than waiting for a real company to exist. This is dev/test
   scaffolding only; production company onboarding is a separate,
   not-yet-built feature and must not be conflated with this seed script.
7. **Import Duty is `category = 'expense'` (5000s)**, `sub_category = 'COGS'`
   or `'Direct Cost'` — it is a cost incurred, not an amount owed to a
   third party, so it does not fit the liability definition. NOTE: once
   Module 2.2 (Inventory) exists, Rules §1.9 requires import duty to be
   capitalized into inventory cost instead of expensed directly — leave a
   code comment flagging this account's treatment for revisit at that
   point, don't build inventory-costing logic now.
8. **[SUPERSEDED 2026-08-22] Zakat Reserve is `category = 'liability'` (2000s),
   `sub_category = 'Provision'` or `'Tax & Zakat Payable'`** — not equity.
   Account name stays `Zakat Reserve` (matching the original feature list's
   literal wording) but its balance-sheet placement is a liability: at the
   reporting date, Zakat due is an amount owed, which fits the liability
   definition more directly than an equity appropriation.
   Businesses that want the AAOIFI-style equity-appropriation treatment
   instead are expected to use the existing **custom account creation**
   feature (already in this spec) to add their own equity-side reserve
   account — the engine does not need special-case logic to support both
   treatments, one default liability account plus the existing custom
   account capability covers it.
   (Prior guidance below is superseded — kept for audit trail, not to be
   implemented.)
   ~~Zakat Reserve is `category = 'equity'` (3000s), `sub_category = 'Reserve'`.~~
   ~~This is a policy judgment, not a mechanical lookup: the spec names it~~
   ~~"Reserve" rather than "Payable," which aligns with AAOIFI treatment of~~
   ~~Zakat as an appropriation of retained earnings rather than a P&L~~
   ~~expense or liability.~~

Logged 2026-08-23, resolving `reverse_journal_entry` RPC review questions:

9. **A reversal entry cannot itself be reversed.** This extends decision #2
   rather than restating it: #2 blocks reversing the *same original entry*
   twice; this blocks reversing an entry whose `entry_type = 'reversal'` at
   all, i.e. there is no "undo the undo" path through the standard reversal
   mechanism. Same rationale as #2 — allowing it would double-count a
   correction and unbalance the ledger. If a reversal itself needs
   correcting, that requires a manual adjusting entry, not a second-order
   reversal.
10. **Data access is backend-mediated via Supabase `service_role` only** —
    no table, view, or RPC in this schema is intended to be called directly
    by an `authenticated`-role client (browser/mobile). This is not a
    style preference: every RLS policy in this schema isolates tenants via
    the session variable `current_setting('app.current_company_id', true)`,
    which only a trusted backend can safely set per-request. A client
    calling Supabase directly with a user JWT has no safe way to set that
    variable, and if one ever could, it could impersonate any company.
    Consequence for every future RPC/function: grant `execute` to
    `service_role` only, never to `authenticated` or `public`, unless a
    specific function is deliberately redesigned around `auth.uid()`-based
    RLS instead — that would be a schema-wide architecture change, not a
    per-function decision, and needs to be raised explicitly if ever
    proposed. The NestJS backend, in turn, must always derive the acting
    user's identity (e.g. `created_by`, `approved_by`, `rejected_by`
    parameters passed to any RPC) from the authenticated request's own
    session context — never from a client-supplied field in the request
    body — since `service_role` bypasses RLS and the backend is the only
    remaining safety net for tenant isolation.

    **Correction, logged 2026-08-23:** the first attempt at this function's
    grants missed `anon` — Supabase auto-grants `EXECUTE` on every new
    `public`-schema function to `anon`, `authenticated`, AND `service_role`
    at creation time. Revoking from `public`/`authenticated` alone left
    `anon` (fully unauthenticated callers) able to call the RPC directly.
    Fixed with `revoke execute ... from anon`, and hardened at the schema
    level so this can't recur silently on future functions:
    ```sql
    alter default privileges in schema public revoke execute on functions from anon;
    alter default privileges in schema public revoke execute on functions from authenticated;
    ```
    Going forward, every new RPC/function must be checked against
    `information_schema.role_routine_grants` after creation — the
    default-privileges change above reduces the risk but doesn't guarantee
    someone won't explicitly re-grant it later.

Logged 2026-08-23, resolving the actor_role/actor_id spoofing finding
from the SupabaseAuthGuard scope review:

11. **`company_members` / `company_role` is intentionally minimal, not
    full RBAC.** Full role-based permissions (custom roles, temporary
    access, per-feature gating) is Module 1.6 (Platform, Settings &
    Security) and is explicitly NOT built here — building it now would be
    scope creep into a different module. The `company_role` enum lists
    all six roles from the original phase-wise feature doc's Module 1.6.B
    (Owner / Accountant / Manager / Staff / Viewer / External Accountant)
    so the table doesn't need reshaping later, but Module 1.1.A only
    enforces two of them: **Owner** bypasses the approval workflow
    entirely (decision #1), and **Owner or Manager** may approve/reject
    a pending entry (Module 1.6.B: "Manager: approve journals... no data
    entry"). Every role check is resolved server-side from
    `company_members` on every call — never trusted from a client-
    supplied `actor_role`/`actor_id` field, which was the vulnerability
    this decision closes.

Logged 2026-08-24, finalizing the real UAE Chart of Accounts (179 accounts,
136 default-active) delivered in `Chart_of_Accounts_-_inFINity.xlsx`,
replacing the generic 100-account template that decision context above
(and `HANDOFF.md` §7 open item #1) previously flagged as wrong-scheme
placeholder content:

12. **Zakat naming, finalized — corrects decision #8's literal wording.**
    Decision #8 said the liability account "stays" named `Zakat Reserve`.
    The finalized COA instead names the **default liability** account
    `2350 Zakat Payable` (`category = 'liability'`, `sub_category =
    'Zakat'`), and reserves the name **`Zakat Reserve`** for `3300`, the
    **equity**, non-default (`is_active = false`) account used only for
    AAOIFI-style Islamic-FI presentation via the existing custom-account
    creation feature. Decision #8's substantive placement logic (liability
    is the default; equity is opt-in via custom accounts, no special-case
    engine logic) is unchanged — only the two accounts' names are
    corrected to match the finalized source file exactly.
13. **Import Duty is two related accounts, not one — extends decision #7,
    does not replace it.** The finalized COA includes both
    `2800 Import Duty Payable` (`category = 'liability'`, `sub_category =
    'Other Liabilities'` — the accrued amount owed to customs before
    settlement, an ordinary payable with no special-case treatment) and
    `5030 Import Duty & Customs Clearance` (`category = 'expense'`,
    `sub_category = 'COGS'` — the actual cost recognized). Decision #7's
    conclusion (`category = 'expense'`, 5000s, and the flag to revisit
    capitalization into inventory once Module 2.2 exists) governs `5030`
    only; `2800` needs no special handling beyond normal payable behavior.
14. **`Account Nature` and `VAT / Tax Mapping`, present in the source COA
    file, have no corresponding columns in `schema.sql`'s `accounts`
    table.** Adding columns is a schema change and out of scope for a
    seed-data task (Cursor's standing rule: never alter `schema.sql` to
    make a feature easier — ask first). Both are preserved instead as a
    structured prefix inside the existing `description` column, e.g.
    `[Contra-Asset] IFRS 9 ECL provision, contra to 1100` or
    `[Control][RCM Input] ...`. VAT-return logic that would actually
    *consume* the VAT Mapping value operationally (e.g. auto-populating a
    VAT 201 return) is out of scope for Module 1.1.A and belongs to
    whichever later module handles VAT filing.
15. **Hierarchy demonstration accounts — net-new, not sourced from the
    Rules PDF or feature list, added solely to prove the engine's
    `parent_account_id`/depth mechanism works**, per the feature spec's
    "create at least a few real 2-3 level examples" requirement. These use
    4-digit codes the finalized COA file leaves unused within their band,
    and are dev-scaffolding in the same spirit as decision #6's fixed-UUID
    seed company — Cursor does not need to stop-and-ask about these
    specific numbers:
    - `1021 Bank Account - Current (AED) - Operations` (parent `1020`, depth 2)
    - `1022 Bank Account - Current (AED) - Payroll Disbursement` (parent `1020`, depth 2)
    - `5101 Salaries & Wages Expense - Head Office` (parent `5100`, depth 2)
    - `5102 Salaries & Wages Expense - Head Office - Management`
      (parent `5101`, depth 3)
16. **`3100 Retained Earnings` is seeded with `is_system_account = true`.**
    It is the year-end closing target (Rules §4.11) and the feature spec's
    system-account concept ("protected from deletion/renumbering")
    applies to it directly — `prevent_account_deletion()` already blocks
    hard deletion of any `is_system_account = true` row regardless of
    transaction history.
17. **A second fixed demo-company UUID was minted — corrects/extends
    decision #6, does not replace it.** Attempting to reseed the
    finalized COA (decisions #12–16) into the original demo company
    (`00000000-0000-0000-0000-000000000001`) correctly aborted: that
    company had accumulated 228 `journal_lines` from Stage 4–13 test runs
    against the old placeholder COA, and the schema's own immutability
    guarantees (`prevent_posted_entry_deletion`, `prevent_account_deletion`)
    refuse to let posted transaction history be deleted — this is the
    guarantee working as intended, not a bug to bypass (no `TRUNCATE`,
    no disabling triggers, no force-delete). Rather than fight that,
    `00000000-0000-0000-0000-000000000001` is retired as legacy
    placeholder-era test data — left untouched, no longer used by any
    seed script, test fixture, or e2e setup going forward. A new fixed
    UUID, `00000000-0000-0000-0000-000000000002` (`'Demo Company
    (Finalized COA Seed)'`), is the one and only demo company for all
    COA-seeding, e2e, and dev/test scaffolding from this point on. Still
    dev/test scaffolding only, per decision #6's original rationale —
    production company onboarding remains a separate, not-yet-built
    feature.
18. E2E test company "teardown," logged 2026-08-24 resolving HANDOFF §7 
    item #4: there is no row-level delete path, by design, and that's 
    correct — not a gap to route around. A company row cannot be deleted 
    once any of its journal_entries are posted: prevent_posted_entry_deletion
    fires per-row even under an ON DELETE CASCADE from companies, exactly 
    like the guard that blocked reseeding …001/…e2e1 above. "Teardown" 
    therefore does NOT mean deleting or truncating old test companies — 
    it means never reusing a fixed ID for a destructive reset in the first 
    place. Fix: e2e test setup generates a fresh, randomly-generated company 
    UUID per test run (not a hardcoded literal like …e2e1/…e2e2), seeds the 
    finalized COA fresh into it every time, and never wipes or reseeds an 
    existing company. Old test companies accumulate as disposable rows in 
    the non-prod Supabase project; reclaiming that space is an infrequent, 
    manual, whole-environment reset (drop/recreate the test project, or a 
    one-off manual cleanup applied directly in the Supabase SQL editor by 
    the developer) — never something app code or Cursor's test suite does 
    automatically.
19. Decision #18's fix extended to ALL fixed-company integration suites, 
    logged 2026-08-24 — this is the third occurrence of the same wall 
    (main demo company, then e2e, now journal-entries.reverse 
    .integration.spec.ts's fixed …b004), and a point-fix per suite would 
    just schedule the next one (approval-rbac and year-end-closing's fixed 
    companies haven't hit it yet only because they haven't been run enough 
    times — not because they're exempt). Rather than mint yet another one-off
    fixed UUID for the reverse suite, the random-UUID-per-run pattern from 
    decision #18 is now the standard for every integration suite that 
    currently uses a hardcoded company literal (…b004 reverse, and the 
    approval-rbac / year-end-closing suites' equivalents) — implemented as 
    one shared setup helper (ensureCompanyWithCoa / equivalent), not 
    duplicated per suite. Same rule as #18: never wipe, never reuse a 
    literal ID across runs; old fixed IDs (…b004 included) are retired 
    untouched.