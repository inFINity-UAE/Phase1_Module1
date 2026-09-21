# Project map (facts from the repo)

API-only NestJS 11 app (`infinity-phase1`). Postgres/Supabase. No frontend, no `.github` CI, no `supabase/` local folder, no generated types, no ESLint config.

## Env and run

| File | Used by |
|---|---|
| `.env.local` | Jest integration/e2e |
| `.env` | `main.ts` (`dotenv/config`) |

Vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, optional `PORT` (default 3000).

```
npm install
npm run start:dev
npm test
npx jest --testPathIgnorePatterns=integration --testPathIgnorePatterns=e2e
node scripts/verify-reset-health.mjs
node scripts/verify-auth-module-imports.mjs
```

Fresh DB: `schema.sql` → `seed_finalized_coa_demo_company_0002.sql` → optional `verify_chart_of_accounts.sql` → `seed_uae_public_holidays.sql` / `seed_ecl_loss_rate_policies.sql` as required by D.

## `src/` modules

| Dir | Role |
|---|---|
| `auth/` | `SupabaseAuthGuard`, `CompanyMembershipGuard`, `@RequireCompanyMembership`, `@CurrentUser` |
| `database/` | `SupabaseService` (secret key + JWT clock-skew retry) |
| `company-members/` | Membership lookup; no HTTP controller |
| `company-settings/` | Entity only; D reads, does not write (except holidays admin) |
| `accounts/` | COA HTTP |
| `accounting-periods/` | Periods + soft-close |
| `journal-entries/` | Draft/post/approve/reject/reverse/OB/YE + lines + E-21 GRNI accrue |
| `recurring-journal-templates/` | Templates + **shared daily cron** |
| `audit-log/` | Read + Nest `delete_blocked` writes |
| `customers/` | C1-1 |
| `quotations/` | C1-2 + convert |
| `invoices/` | C1-3 + Issue/Void/write-off/debtor-notified |
| `credit-notes/` | C1-4 |
| `payments/` | D payments + applications |
| `public-holidays/` | D-14 |
| `suppliers/` | E suppliers |
| `purchase-orders/` | E POs + nested lines |
| `goods-receipts/` | E GRNs + nested lines |
| `bills/` | E bills + match/issue/approve/void |
| `supplier-payments/` | E payments, runs, statement lines |
| `reports/` | H1 + H2 reads + D AR + E AP + F VAT report RPCs |
| `vat/` | F VAT 201, apportionment, CAS, claims, VD |
| `ct/` | G UAE CT 9% provision, SBR monitor, related-party log |
| `test/`, `e2e/` | Shared mint + packs |

Pattern: `*.module.ts` provides `SYMBOL` → `Supabase*Repository`. `AppModule` imports feature modules + `ScheduleModule`. `AuthModule` is imported by each guarded feature module (not listed separately on `AppModule`).

## Tables (`schema.sql`)

`companies`, `company_settings`, `company_members`, `accounts`, `public_holidays`, `accounting_periods`, `journal_entries`, `journal_lines`, `journal_attachments`, `recurring_journal_templates`, `recurring_journal_template_lines`, `audit_log`, `customers`, `quotations`, `quotation_lines`, `invoices`, `invoice_lines`, `credit_notes`, `credit_note_lines`, `payments`, `payment_applications`, `write_offs`, `ecl_loss_rate_policies`, `ecl_provision_runs`, `suppliers`, `purchase_orders`, `purchase_order_lines`, `goods_receipts`, `goods_receipt_lines`, `bills`, `bill_lines`, `three_way_match_results`, `supplier_payments`, `supplier_payment_applications`, `supplier_payment_runs`, `supplier_payment_run_items`, `supplier_statement_lines`, `grni_accrual_runs`, `vat_tax_rule_versions`, `vat_return_box_definitions`, `vat_return_periods`, `vat_return_line_items`, `vat_return_line_item_sources`, `vat_apportionment_calculations`, `capital_goods_projects`, `capital_goods_items`, `capital_goods_adjustments`, `vat_bad_debt_relief_claims`, `vat_voluntary_disclosures`, `vat_period_corrections`, `fta_filing_log`, `ct_tax_rule_versions`, `ct_income_adjustments`, `ct_provision_entries`, `related_party_transactions`. View: `vat_invoice_register`.

## Isolation

RLS `company_isolation_*` on tenant tables via `current_setting('app.current_company_id')`. `companies` + `company_members` use membership (`private.is_company_member`). Nest `service_role` bypasses RLS → **always** filter `company_id` in repositories and resolve membership first.

`CompanyResourceKind` (extend when adding `:id` routes): journal_entry, journal_line, account, accounting_period, recurring_template, recurring_template_line, customer, quotation, quotation_line, invoice, invoice_line, credit_note, credit_note_line, payment, payment_application, public_holiday, supplier, purchase_order, purchase_order_line, goods_receipt, goods_receipt_line, bill, bill_line, supplier_payment, supplier_payment_application, supplier_payment_run, supplier_statement_line, vat_return_period, capital_goods_item, capital_goods_project, vat_bad_debt_relief_claim, vat_voluntary_disclosure, vat_period_correction.

## Key RPCs (not exhaustive)

Ledger: `allocate_next_entry_number`, `insert_journal_entry_draft`, `create_opening_balance_entry`, `create_year_end_closing_entry`, `generate_due_recurring_entry`, `reverse_journal_entry`.

C: `issue_invoice`, `void_invoice`, `issue_credit_note`, `void_credit_note`, `convert_quotation_to_invoice`, `mark_overdue_invoices`, `expire_due_quotations`.

D: `create_payment_journal_entry`, `create_advance_application_journal_entry`, `create_invoice_write_off`, `run_ecl_provision`, `mark_vat_relief_eligible`, `add_business_days`, `is_business_day`.

E: `run_three_way_match`, `create_bill_journal_entry`, `issue_bill`, `void_bill`, `create_supplier_payment_journal_entry`, `create_supplier_advance_application_journal_entry`, `execute_supplier_payment_run`, `accrue_unbilled_receipts`, `get_supplier_ledger`, `get_aged_payables`, `get_bills_due`, `reconcile_supplier_statement`. Helper: `bill_is_payable`.

F: `calculate_vat_return`, `submit_vat_return_for_review`, `approve_vat_return`, `file_vat_return`, `export_vat_return`, `reconcile_vat_return`, `claim_vat_refund`, `record_vat_payment`, `accrue_vat_penalty`, `calculate_partial_exemption`, `assert_cas_threshold`, `run_capital_goods_adjustment`, `claim_bad_debt_relief`, `create_vat_period_correction`, `approve_vat_voluntary_disclosure`, `get_invoice_register`, `assemble_vat_audit_pack`, `get_vat_registration_threshold`, `assert_not_filed_vat_period`. Posting still via `post_journal_entry` / `post_vat_journal_entry`.

G: `get_ct_taxable_profit_estimate`, `create_ct_provision_entry`, `check_small_business_relief_eligibility`, `summarize_free_zone_income`, `record_related_party_transaction`, `prepare_ct_return_summary`, `check_ct_penalty_exposure`. `create_year_end_closing_entry` extended with `p_skip_ct_check` / `p_skip_reason` (G-22).

Reports: `get_trial_balance_for_period`, `get_trial_balance_for_range`, `get_balance_sheet`, `get_profit_and_loss`, `get_profit_and_loss_comparison`, `get_general_ledger` (6-arg: optional `limit`/`offset`), `get_expense_analysis`, `get_sales_by_customer` (ex-VAT `line_net_amount`; H2-15), `get_customer_ledger`, `get_aged_receivables`, `check_customer_credit_limit`, `get_customer_payment_history`. Helper: `is_ledger_truth_status`, `account_signed_balance`. Executive summary and audit pack are Nest composition (no extra SQL).

## HTTP surface (prefix)

`/accounts`, `/accounting-periods`, `/journal-entries`, `/journal-lines`, `/recurring-journal-templates`, `/audit-log`, `/customers`, `/quotations`, `/quotation-lines`, `/invoices`, `/invoice-lines`, `/credit-notes`, `/credit-note-lines`, `/payments`, `/payment-applications`, `/public-holidays`, `/suppliers`, `/purchase-orders`, `/goods-receipts`, `/bills`, `/supplier-payments`, `/supplier-payment-runs`, `/supplier-statement-lines`, `/vat-returns`, `/vat-apportionment`, `/capital-goods-projects`, `/capital-goods-items`, `/bad-debt-relief-claims`, `/vat-voluntary-disclosures`, `/ct/*`, `/reports/*`.

Reports: trial-balance, trial-balance-range, balance-sheet, profit-and-loss, profit-and-loss-comparison, general-ledger (`limit`/`offset` optional), expense-analysis, sales-by-customer, executive-summary, audit-pack, customer-ledger, customer-statement (data), aged-receivables, credit-limit-check, customer-payment-history, supplier-ledger, aged-payables, bills-due, reconcile-supplier-statement, invoice-register, vat-registration-threshold, vat-audit-pack/:id. `?format=csv` on H1 four + H2 report routes (not D/E/F reports).

Journal extras: `POST /journal-entries/accrue-unbilled-receipts` (E-21, static path before `:id`).

## Posting account numbers (do not invent others)

| Number | Use |
|---|---|
| 1010 / 1020 / 1070 | Payment debit routing (D-12) |
| 1100 | AR control (invoice Issue) |
| 1110 / 5640 | ECL allowance / expense |
| 2060 | Customer advances |
| 2200 | Output VAT |
| 3100 | Retained earnings (YE) |
| 4060 | Sales discounts |
| 2000 | AP control (bill Issue) |
| 1400 | Input VAT |
| 1410 / 2210 | Reverse-charge input / output (F-25, inside bill JE) |
| 1415 / 5641 | Recoverable VAT relief / VAT relief expense (F-41) |
| 1350 | Supplier advances (E-23) |
| 5060 | Purchase discounts |
| 2020 | GRNI accrual (E-21) |
| 5800 / 5580 | Blocked input VAT / entertainment (F-25) |
| 5830 / 2300 | CT expense / CT payable (G-13) |
| 4300 / 4310 / 4320 | QFZP QI / NQI / mainland (G-24) |
| 5810 / 5930 | VAT penalties / fines CT add-back (G-18) |

## Tests

Live DB; skip without keys. Shared setup: `src/test/integration-company.setup.ts`, `src/e2e/e2e-company.setup.ts`. `controller-auth-coverage` **218** guarded routes. F: `src/vat/vat.service.spec.ts` (F-8/F-10 roles) + `src/vat/vat-returns.integration.spec.ts` (calculate/file/lock). G: `src/ct/ct.service.spec.ts` + `src/ct/ct.integration.spec.ts`. H2: `src/reports/reports.service.spec.ts` + `src/reports/reports.h1-integrity-sweep.integration.spec.ts`. Invoice Issue and membership isolation cover F Issue guards.

## Scripts

`verify-reset-health.mjs`, `verify-auth-module-imports.mjs`, `generate_coa_seed.py`, `hijri_holiday_projection.py`, `trigger-execute-empirical-test.mjs`.

`tmp/` is gitignored MCP / live-apply scratch — not SoT.
