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