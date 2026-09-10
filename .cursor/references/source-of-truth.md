# Source of truth — authority and known conflicts

When sources disagree, **do not guess**. Report the conflict. Authority order is in `.cursor/rules/accounting-engine.mdc`.

## What each class of document is

| Class | Role | Example |
|---|---|---|
| Accounting policy | What the books must do | `Accounting Rules - inFINity.pdf` |
| Database | What Postgres actually enforces | `schema.sql` |
| Module spec | What this module builds, including decision log | `feature-spec.md`, `feature-spec-1.1.C.md`, `feature-spec-1_1_D.md`, `feature-spec-1.1.H1.md`, `feature-spec-1_1_E.md` |
| Sequencing | Order of modules, not rules | `Module_1.1_Build_Order_Scope.md` |
| Implementation | What Nest/SQL does today | `src/**` |
| Tests | What we currently assert | `src/**/*.spec.ts` |
| Manual / README | Onboarding and narrative | `README.md`, `INFINITY_ACCOUNTING_DOCUMENTATION.md` |

**Business rules** come from the PDF + the owning module spec. **Schema shape** comes from `schema.sql`. If code and spec disagree, that is a **gap** (see gap-audit skill), not a license to pick one silently.

`apply_*.sql` files are incremental patches for already-applied DBs. They must match `schema.sql`. Fresh DB = `schema.sql` + seeds only.

Excel COA (`Chart of Accounts - inFINity.xlsx`) + `seed_finalized_coa_demo_company_0002.sql` are authoritative for account numbers/names. Demo company has 183 accounts (179 COA + hierarchy demo accounts per A §2.3).

## Known documentation drift (do not “fix” by inventing)

These were true at inspection (2026-09-10). Prefer newer module specs / `schema.sql` / tests.

1. **`.cursor/rules/accounting-engine.mdc` (pre-update)** said Module 1.1.A only. Build Order: A, H1, C1, D built; E specified.
2. **`README.md`** still titles “Module 1.1.A” and cites 34 suites / 339 tests. Later verified: C1-5 51/535; D-P13 **573 passed / 59 suites green** (1 unit-spec compile gap).
3. **`feature-spec.md` §5.6 / §5.11** still mention 38 routes / 7 controllers. `controller-auth-coverage.spec.ts` covers **102** guarded routes. §7.2 C-era 83/83 is also stale vs D controllers (payments, holidays).
4. **`feature-spec.md` §7.2** snapshot is post-C1-5 (535 tests), not D.
5. **`INFINITY_ACCOUNTING_DOCUMENTATION.md`** (4 Sep 2026) says payments, write-off ledger, aged AR, customer statements are not built. D signed off 10 Sep 2026 — those **are** built (statement is **data** only, not PDF).
6. **`feature-spec-1_1_D.md` intro** “Confirmed in-schema” block is **pre-build evidence** (no payments table yet, invoice statuses unwired). The status line at the top is the current one: D is built. Do not re-litigate the intro as live schema.
7. **D §7** still calls E’s Bill entity an open question. **E-1** closed it as Option A (`bills` table).
8. **H1 spec** defers aged AR; D added `GET /reports/aged-receivables` without expanding H1’s scope document. Owning spec for aged AR is D §5.2.
9. **`schema.sql` header** says do not maintain `apply_*.sql`; D-P13 requires ten idempotent `apply_*.sql` files **and** a folded `schema.sql`. Both exist on purpose.

## Stubs / not built (do not document as complete)

- Hard-close, reopen, close checklist HTTP (`feature-spec.md` known open items)
- Company onboarding / members admin API
- C §9 presentation (PDF, WhatsApp, bilingual, reminders, recurring invoices)
- D §7: 1070→1020 settlement, VAT-201 filing, exports, dunning, multi-currency, company-settings write API
- Module E (suppliers, bills, AP)
- Modules B, F, G, H remainder
- Frontend
