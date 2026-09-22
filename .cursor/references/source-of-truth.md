# Source of truth — authority and known conflicts

When sources disagree, **do not guess**. Report the conflict. Authority order is in `.cursor/rules/accounting-engine.mdc`.

## What each class of document is

| Class | Role | Example |
|---|---|---|
| Accounting policy | What the books must do | `Accounting Rules - inFINity.pdf` |
| Database | What Postgres actually enforces | `schema.sql` |
| Module spec | What this module builds, including decision log | `feature-spec.md`, `feature-spec-1.1.C.md`, `feature-spec-1_1_D.md`, `feature-spec-1.1.H.md`, `feature-spec-1_1_E.md`, `feature-spec-1_1_F.md`, `feature-spec-1_1_G.md` |
| Sequencing | Order of modules, not rules | `Module_1.1_Build_Order_Scope.md` |
| Implementation | What Nest/SQL does today | `src/**` |
| Tests | What we currently assert | `src/**/*.spec.ts` |
| Manual / README | Onboarding and narrative | `README.md`, `INFINITY_ACCOUNTING_DOCUMENTATION.md` |

**Business rules** come from the PDF + the owning module spec. **Schema shape** comes from `schema.sql`. If code and spec disagree, that is a **gap** (see gap-audit skill), not a license to pick one silently.

Fresh DB = `schema.sql` + seeds only. Do not add separate `apply_*.sql` patches — fold DDL into `schema.sql` (per its header).

Excel COA (`Chart of Accounts - inFINity.xlsx`) + `seed_finalized_coa_demo_company_0002.sql` are authoritative for account numbers/names. Demo company has 186 accounts (180 COA + 4 hierarchy demos + F-41 `1415`/`5641`).

## Known documentation drift (do not “fix” by inventing)

These were true at inspection (2026-09-10), with later notes dated in-place. Prefer newer module specs / `schema.sql` / tests.

1. **`.cursor/rules/accounting-engine.mdc` (pre-F)** said next specified was F. F is built 2026-09-16; G 2026-09-18; H2 2026-09-20. **B** remains queued. Leftover H-R items are H-R2/H-R4/H-R7/H-R8/PDF-XLSX/H-R14/H-R15.
2. **`README.md`** still titles “Module 1.1.A” and cites 34 suites / 339 tests. Later verified: C1-5 51/535; D-P13 **573 passed / 59 suites green** (1 unit-spec compile gap). No later full-suite number is recorded here.
3. **`feature-spec.md` §5.6 / §5.11** still mention 38 routes / 7 controllers. Live `controller-auth-coverage.spec.ts` covers **218** guarded routes (H2 added six GETs). §7.2 C-era 83/83 is also stale vs later controllers.
4. **`feature-spec.md` §7.2** snapshot is post-C1-5 (535 tests), not D/E/F/G/H2.
5. **`INFINITY_ACCOUNTING_DOCUMENTATION.md`** (4 Sep 2026) says payments, write-off ledger, aged AR, customer statements are not built. D signed off 10 Sep 2026 — those **are** built (statement is **data** only, not PDF).
6. **`feature-spec-1_1_D.md` intro** “Confirmed in-schema” block is **pre-build evidence** (no payments table yet, invoice statuses unwired). The status line at the top is the current one: D is built. Do not re-litigate the intro as live schema.
7. **D §7** still calls E’s Bill entity an open question. **E-1** closed it as Option A (`bills` table).
8. **Module H spec** is `feature-spec-1.1.H.md` (merged 2026-09-21, #9; pointer files removed #10). H1 #1–#8 are Part I; H2-1…H2-15 are Part II. Aged AR/AP remain D/E `/reports`. Numbered H1 #1–#8 and H2-1…H2-15 bodies were not rewritten.
9. **`schema.sql` header** says do not maintain `apply_*.sql`. Incremental Module D patches were verified at D-P13 then **removed** — structure lives only in `schema.sql`. H2 DDL was folded into `schema.sql` the same way.
10. **D/E/F/G “H-remainder owns generic export”** numbered decisions still describe their own pass. Standing fact: H2-7 closed CSV for H1 four + H2 report routes only — not D statement PDF, not D/E/F report CSV, not PDF/XLSX.

## Stubs / not built (do not document as complete)

- Hard-close, reopen, close checklist HTTP (`feature-spec.md` known open items)
- Company onboarding / members admin API
- C §9 presentation (PDF, WhatsApp, bilingual, reminders, recurring invoices)
- D §7: 1070→1020 settlement, statement PDF, dunning, multi-currency, company-settings write API
- E §7 deferrals: vendor credits, unattended GRNI cron, inventory/landed costs, settings admin API (E itself is built 2026-09-13)
- Module F §0 residuals: 10k VD threshold confirm, Box 2/CAS screenshot (engine built 2026-09-16). F-41 `1415`/`5641` **are** in the demo COA seed (186). Optional live cleanup: backfill `vat_category` on issued lines that predate F.
- Module B (OCR)
- Leftover H-R: H-R2 UAE BS layout, H-R4 cash flow, H-R7/H-R8 product/salesperson sales, PDF/XLSX, H-R14 email, H-R15 share link (H2 itself is built 2026-09-20)
- Frontend
