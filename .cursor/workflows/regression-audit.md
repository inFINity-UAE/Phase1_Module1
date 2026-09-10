# Regression audit

Trigger: “Run regression audit”.

Goal: what recent changes could have broken.

## Inspect the diff / named commits

- Callers of changed functions (grep; fix once at the shared helper)
- HTTP contracts (DTO fields, status codes, route paths)
- DB: trigger/RPC signatures, RLS, grants
- Accounting: posting, balance trigger, ledger-truth filters
- Shared cron host (`RecurringJournalSchedulerService`)
- Auth coverage list vs new routes
- `CompanyResourceKind` vs new `:id` resources

## Run (smallest first)

1. Unit specs for touched services
2. Matching `*.integration.spec.ts`
3. Auth: `controller-auth-coverage.spec.ts` and/or `verify-auth-module-imports.mjs` if routes/modules changed
4. Broader: integrity sweep / H1 reports / excel TC / e2e only if ledger posting, periods, or reports changed

Quote commands and results. If keys are missing and integration skipped, say tests were skipped — do not call that a pass.
