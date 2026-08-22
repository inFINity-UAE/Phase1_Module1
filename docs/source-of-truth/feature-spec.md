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

Logged 2026-08-22, resolving Stage 1 (COA seed) questions:

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
8. **Zakat Reserve is `category = 'equity'` (3000s), `sub_category = 'Reserve'`.**
   This is a policy judgment, not a mechanical lookup: the spec names it
   "Reserve" rather than "Payable," which aligns with AAOIFI treatment of
   Zakat as an appropriation of retained earnings rather than a P&L
   expense or liability. FLAG FOR HUMAN REVIEW: confirm this treatment
   with the business's Zakat/Islamic-finance advisor before this ships —
   conventional practice in some UAE businesses instead books a "Zakat
   Payable" liability at the point of obligation, which is a materially
   different balance-sheet presentation.