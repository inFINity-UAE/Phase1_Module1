# inFINity Phase 1 - Module 1.1.A

NestJS double-entry accounting engine (UAE) backed by Supabase/Postgres.

## Source of truth (priority order)

1. `docs/source-of-truth/Accounting Rules - inFINity.pdf`
2. `docs/source-of-truth/schema.sql`
3. `docs/source-of-truth/feature-spec.md`

## Fresh Supabase setup

Apply in the SQL Editor, in order:

1. `docs/source-of-truth/schema.sql` - full schema, RPCs, grants (§12)
2. `docs/source-of-truth/seed_finalized_coa_demo_company_0002.sql` - demo COA (...0002)
3. Optional: `docs/source-of-truth/verify_chart_of_accounts.sql` - seed checks

If an existing live DB was applied before decision #45, also run
`docs/source-of-truth/apply_account_parent_same_company.sql` once (extends
`enforce_account_hierarchy_depth` with same-company parent check).

If an existing live DB was applied before decision #46, also run
`docs/source-of-truth/apply_journal_balance_on_post_insert.sql` once
(extends `trg_enforce_journal_balance_on_post` to fire on INSERT).

Current `schema.sql` forces `btree_gist` into `extensions` and puts
`is_company_member` in `private` (and drops any leftover
`public.is_company_member`). If Advisor still warns on a DB that was
applied from an older schema revision, run
`docs/source-of-truth/apply_security_advisor_lints.sql` once.

## Local app

```bash
cp .env.example .env.local   # set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY
npm install
npm test
npm run start:dev
```

## Regenerate COA seed from Excel

```bash
python scripts/generate_coa_seed.py
```
