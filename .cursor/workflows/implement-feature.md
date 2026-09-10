# Implement a feature

Trigger: “Implement X”, “build Module …”, “add …”. Do not code before Phase 4.

## Phase 1 — Understand

- Owning feature spec + decision log
- PDF sections if accounting
- `schema.sql` tables/RPCs/triggers/RLS
- Existing Nest module of the same shape (C invoice vs E bill, D payment vs E supplier payment)
- Tests and `CompanyResourceKind`

## Phase 2 — Impact

Frontend (none today) · Nest · DB · accounting · security · API · tests · docs.

## Phase 3 — Plan

Short plan: files, RPCs, routes, tests, out-of-scope items you will **not** build. If this changes a signed-off decision, switch to `architectural-decision.md` first.

## Phase 4 — Implement

Smallest coherent change. Cite spec in comments. Reuse guards, `handleDatabaseError`, mint helper, existing RPCs.

## Phase 5 — Validate

Run what you touched, then quote output:

- `npx tsc -p tsconfig.build.json --noEmit` or `npm run build` when types/API changed
- Relevant `npx jest <spec>`
- `node scripts/verify-auth-module-imports.mjs` if a controller was added
- No ESLint/CI in repo — do not claim they ran

## Phase 6 — Audit

Regressions, tenant isolation, accounting invariants (`.cursor/checklists/accounting-invariants.md`), incomplete branches, doc drift.

## Phase 7 — Report

`.cursor/templates/engineering-task.md` plus `.cursor/checklists/feature-complete.md`.
