# inFINity Phase 1 — Module 1.1.A

NestJS double-entry accounting engine (UAE) backed by Supabase/Postgres.

Use this README when opening the project in a **new editor window** or on a
**new machine** — follow the sections in order.

---

## Prerequisites

| Tool | Notes |
|---|---|
| **Node.js 20+** (22 recommended) | `node -v` |
| **npm** | Bundled with Node |
| **Supabase project** | Free tier is fine; you need Dashboard access to run SQL |
| **Python 3** | Only if regenerating the COA seed from Excel (optional) |

---

## 1. Clone and install

```bash
cd Phase1_Build          # or your clone path
npm install
```

---

## 2. Environment variables

Copy the example file and fill in values from **Supabase → Project Settings → API Keys**
(use the **publishable** and **secret** keys — not legacy `anon` / `service_role` JWTs):

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
```

**Two env files — same values:**

| File | Used by |
|---|---|
| `.env.local` | Integration/e2e tests (Jest loads this explicitly) |
| `.env` | Nest dev/prod server (`main.ts` uses `dotenv/config`, which reads `.env` only) |

After editing `.env.local`, copy it for the app:

```bash
cp .env.local .env
```

Both files are gitignored — never commit them.

Optional: `PORT=3000` in `.env` (default is 3000).

---

## 3. Supabase database (first time or after reset)

Open **Supabase → SQL Editor** and run **in order**:

1. **`docs/source-of-truth/schema.sql`** — full schema, RPCs, RLS, triggers, grants
2. **`docs/source-of-truth/seed_finalized_coa_demo_company_0002.sql`** — demo company `…0002` + 183-account COA
3. *(Optional)* **`docs/source-of-truth/verify_chart_of_accounts.sql`** — sanity checks on the seed

No other SQL files are required on a fresh apply (decisions #45–#48 are already in `schema.sql`).

**Verify from the repo** (requires `.env.local`):

```bash
node scripts/verify-reset-health.mjs
```

Expect 7/7 COA checks pass and demo company `00000000-0000-0000-0000-000000000002` with 183 accounts.

---

## 4. Run tests

```bash
# Full suite — unit + live-DB integration + e2e (~2–3 min, needs .env.local)
npm test

# Faster parallel run (same tests)
npx jest --maxWorkers=50%

# Unit tests only (no Supabase needed)
npx jest --testPathIgnorePatterns=integration --testPathIgnorePatterns=e2e
```

Integration/e2e suites **skip automatically** if `NEXT_PUBLIC_SUPABASE_URL` or
`SUPABASE_SECRET_KEY` is missing. With keys set, they mint fresh test companies
against your live project (demo `…0002` is read-only COA clone source — never wiped).

Current baseline: **30 suites / 314 tests** (see `feature-spec.md` §7.2).

---

## 5. Run the API locally

```bash
npm run build          # optional — checks TypeScript compiles
npm run start:dev      # watch mode on http://localhost:3000 (or PORT)
```

**Auth:** every route requires a valid Supabase user JWT:

```http
Authorization: Bearer <access_token>
```

The backend uses `SUPABASE_SECRET_KEY` for DB access; tenant isolation is enforced
by `CompanyMembershipGuard` + explicit `company_id` filters (see `feature-spec.md` §5.11).

---

## 6. Other npm scripts

| Command | Purpose |
|---|---|
| `npm run build` | Compile to `dist/` |
| `npm run start` | Run compiled app (no watch) |
| `npm run start:prod` | `node dist/main` |
| `npm run test:watch` | Jest watch mode |

---

## Source of truth (priority order)

1. `docs/source-of-truth/Accounting Rules - inFINity.pdf`
2. `docs/source-of-truth/schema.sql`
3. `docs/source-of-truth/feature-spec.md`

Accounting rules, schema, and feature spec **must agree** — do not invent business
logic not stated there (see `.cursor/rules/accounting-engine.mdc`).

---

## Repo layout (quick map)

```
src/
  accounts/              Chart of accounts HTTP API
  accounting-periods/    Fiscal periods
  journal-entries/       Ledger entries, lines, posting, reversal, year-end
  recurring-journal-templates/
  audit-log/
  auth/                  SupabaseAuthGuard, CompanyMembershipGuard
  database/              Supabase client (service_role / secret key)
docs/source-of-truth/    schema.sql, seed, feature-spec, PDF rules
scripts/
  verify-reset-health.mjs       Post-reset DB + COA probe
  trigger-execute-empirical-test.mjs   PGlite grant/trigger experiment
  generate_coa_seed.py            Regenerate seed SQL from Excel
```

---

## Regenerate COA seed from Excel (optional)

```bash
python scripts/generate_coa_seed.py
```

Output targets `docs/source-of-truth/seed_finalized_coa_demo_company_0002.sql`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set` | Create `.env` (app) or `.env.local` (tests) with all three vars |
| Integration tests skipped | Same — keys missing in `.env.local` |
| `42501 permission denied` on Supabase | Re-run `schema.sql` §12 table grants on the project |
| Tests timeout on first `beforeAll` | DB cold start or parallel load — retry; e2e alone: `npx jest src/e2e/ledger-lifecycle.e2e.spec.ts` |
| Fresh project, empty tables | Run seed SQL after schema (step 3) |
