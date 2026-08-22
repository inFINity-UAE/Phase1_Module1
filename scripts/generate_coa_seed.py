"""Generate seed_chart_of_accounts.sql and verify locally."""
from __future__ import annotations

from collections import Counter
from pathlib import Path

COMPANY_ID = "00000000-0000-0000-0000-000000000001"
CAT_PREFIX = {"asset": "1", "liability": "2", "equity": "3", "income": "4", "expense": "5"}

# (number, name, category, sub_category, normal_balance, parent|None, depth, is_system, description)
accounts = [
    ("1010", "Cash", "asset", "Cash & Bank", "debit", None, 1, False, "Parent cash control. [Rules §1.2 Current Assets → Cash & Bank]"),
    ("1011", "Cash - Operating", "asset", "Cash & Bank", "debit", "1010", 2, False, "Operating cash sub-account under Cash."),
    ("1012", "Cash - Payroll", "asset", "Cash & Bank", "debit", "1011", 3, False, "Payroll cash under Cash - Operating (hierarchy proof: 1010→1011→1012)."),
    ("1013", "Cash - Savings", "asset", "Cash & Bank", "debit", "1010", 2, False, "Interest-bearing cash reserves."),
    ("1014", "Petty Cash", "asset", "Cash & Bank", "debit", "1010", 2, False, "Imprest petty cash. [Rules §1.21]"),
    ("1020", "Bank - Current Account", "asset", "Cash & Bank", "debit", None, 1, False, "Primary AED current account."),
    ("1021", "Bank - Call Deposit", "asset", "Cash & Bank", "debit", None, 1, False, "Short-notice bank deposit account."),
    ("1050", "Trade Receivables", "asset", "Trade Receivables", "debit", None, 1, False, "AR control. [Rules §1.2]"),
    ("1051", "Trade Receivables - Domestic", "asset", "Trade Receivables", "debit", "1050", 2, False, "UAE domestic customer receivables."),
    ("1052", "Trade Receivables - Export", "asset", "Trade Receivables", "debit", "1050", 2, False, "Export/overseas customer receivables."),
    ("1060", "Allowance for Doubtful Debts", "asset", "Trade Receivables", "credit", None, 1, False, "Contra-asset ECL allowance. [Rules §1.4 / §3.6]"),
    ("1070", "VAT Receivable", "asset", "Current Assets", "debit", None, 1, False, "Input VAT recoverable. [feature-spec UAE-specific] [Rules §1.2 VAT recoverable]"),
    ("1080", "Other Receivables", "asset", "Current Assets", "debit", None, 1, False, "Non-trade receivables."),
    ("1090", "Employee Advances", "asset", "Current Assets", "debit", None, 1, False, "Staff advances recoverable."),
    ("1100", "Inventory", "asset", "Inventory", "debit", None, 1, False, "Inventory control. [Rules §1.2 / §1.9]"),
    ("1101", "Inventory - Raw Materials", "asset", "Inventory", "debit", "1100", 2, False, "Raw materials stock."),
    ("1102", "Inventory - Work in Process", "asset", "Inventory", "debit", "1100", 2, False, "WIP inventory."),
    ("1103", "Inventory - Finished Goods", "asset", "Inventory", "debit", "1100", 2, False, "Finished goods held for sale."),
    ("1104", "Inventory - Merchandise", "asset", "Inventory", "debit", "1100", 2, False, "Merchandise purchased for resale."),
    ("1200", "Prepayments", "asset", "Prepayments", "debit", None, 1, False, "Prepayments control. [Rules §1.2]"),
    ("1201", "Prepaid Rent", "asset", "Prepayments", "debit", "1200", 2, False, "Rent paid in advance."),
    ("1202", "Prepaid Insurance", "asset", "Prepayments", "debit", "1200", 2, False, "Insurance premiums paid in advance."),
    ("1203", "Prepaid Software & Subscriptions", "asset", "Prepayments", "debit", "1200", 2, False, "Software/subscriptions paid in advance."),
    ("1210", "Accrued Income", "asset", "Current Assets", "debit", None, 1, False, "Income earned but not yet billed."),
    ("1220", "Short-Term Investments", "asset", "Investments", "debit", None, 1, False, "Investments expected to be realized within 12 months. [Rules §1.2]"),
    ("1230", "Other Current Assets", "asset", "Current Assets", "debit", None, 1, False, "Miscellaneous current assets."),
    ("1500", "Property, Plant & Equipment", "asset", "PP&E", "debit", None, 1, False, "PP&E control. [Rules §1.2 Non-Current Assets → PP&E]"),
    ("1510", "Land", "asset", "PP&E", "debit", "1500", 2, False, "Land at cost (non-depreciable). [Rules §1.7]"),
    ("1520", "Buildings", "asset", "PP&E", "debit", "1500", 2, False, "Buildings at cost."),
    ("1525", "Accumulated Depreciation - Buildings", "asset", "PP&E", "credit", None, 1, False, "Contra-asset accumulated depreciation - buildings. [Rules §1.7]"),
    ("1530", "Equipment & Machinery", "asset", "PP&E", "debit", "1500", 2, False, "Equipment and machinery at cost."),
    ("1535", "Accumulated Depreciation - Equipment", "asset", "PP&E", "credit", None, 1, False, "Contra-asset accumulated depreciation - equipment."),
    ("1540", "Furniture & Fixtures", "asset", "PP&E", "debit", "1500", 2, False, "Furniture and fixtures at cost."),
    ("1545", "Accumulated Depreciation - Furniture & Fixtures", "asset", "PP&E", "credit", None, 1, False, "Contra-asset accumulated depreciation - furniture."),
    ("1550", "Vehicles", "asset", "PP&E", "debit", "1500", 2, False, "Company vehicles at cost."),
    ("1555", "Accumulated Depreciation - Vehicles", "asset", "PP&E", "credit", None, 1, False, "Contra-asset accumulated depreciation - vehicles."),
    ("1560", "Computer Hardware & IT", "asset", "PP&E", "debit", "1500", 2, False, "IT hardware at cost."),
    ("1565", "Accumulated Depreciation - IT Equipment", "asset", "PP&E", "credit", None, 1, False, "Contra-asset accumulated depreciation - IT."),
    ("1600", "Intangible Assets", "asset", "Intangibles", "debit", None, 1, False, "Intangibles control. [Rules §1.2 / §1.8]"),
    ("1601", "Patents & Trademarks", "asset", "Intangibles", "debit", "1600", 2, False, "Patents and trademarks at cost."),
    ("1602", "Capitalized Software", "asset", "Intangibles", "debit", "1600", 2, False, "Capitalized software development/licenses."),
    ("1605", "Accumulated Amortization - Intangibles", "asset", "Intangibles", "credit", None, 1, False, "Contra-asset accumulated amortization."),
    ("1700", "Long-Term Investments", "asset", "Investments", "debit", None, 1, False, "Investments held beyond 12 months. [Rules §1.2]"),
    ("2010", "Trade Payables", "liability", "Current Liabilities", "credit", None, 1, False, "AP control. [Rules §1.2 / §1.5]"),
    ("2020", "Accrued Expenses", "liability", "Current Liabilities", "credit", None, 1, False, "Expenses incurred not yet invoiced."),
    ("2030", "Salaries Payable", "liability", "Current Liabilities", "credit", None, 1, False, "Accrued salaries control. [Rules §1.6]"),
    ("2040", "End-of-Service Benefits Payable", "liability", "Current Liabilities", "credit", None, 1, False, "UAE gratuity / EOSB accrual liability. [Rules §1.6]"),
    ("2050", "VAT Payable", "liability", "Current Liabilities", "credit", None, 1, False, "Output VAT payable to FTA. [feature-spec UAE-specific] [Rules §1.2 VAT payable]"),
    ("2060", "CT Provision", "liability", "Current Liabilities", "credit", None, 1, False, "UAE Corporate Tax provision. [feature-spec UAE-specific] [Rules §1.2 Corporate Tax payable]"),
    ("2065", "Zakat Reserve", "liability", "Tax & Zakat Payable", "credit", None, 1, False, "Zakat obligation reserve. [feature-spec UAE-specific] [feature-spec product decision 8 — liability 2000s; businesses needing alternate treatment use custom account creation]"),
    ("2070", "Unearned Revenue", "liability", "Current Liabilities", "credit", None, 1, False, "Deferred/unearned revenue liability. [Rules §1.11]"),
    ("2080", "Customer Advances", "liability", "Current Liabilities", "credit", None, 1, False, "Customer deposits and retainers."),
    ("2090", "Credit Card Payable", "liability", "Current Liabilities", "credit", None, 1, False, "Corporate card balances due."),
    ("2100", "Short-Term Loans Payable", "liability", "Current Liabilities", "credit", None, 1, False, "Borrowings due within 12 months."),
    ("2110", "Current Portion of Long-Term Debt", "liability", "Current Liabilities", "credit", None, 1, False, "LT debt principal due within 12 months."),
    ("2120", "Accrued Interest Payable", "liability", "Current Liabilities", "credit", None, 1, False, "Interest accrued not yet paid."),
    ("2130", "Other Current Liabilities", "liability", "Current Liabilities", "credit", None, 1, False, "Miscellaneous current liabilities."),
    ("2500", "Long-Term Loans Payable", "liability", "Non-Current Liabilities", "credit", None, 1, False, "Borrowings due after 12 months."),
    ("2510", "Lease Liabilities", "liability", "Non-Current Liabilities", "credit", None, 1, False, "IFRS 16 lease liability (GL account only). [Rules §1.12]"),
    ("2520", "Other Non-Current Liabilities", "liability", "Non-Current Liabilities", "credit", None, 1, False, "Miscellaneous non-current liabilities."),
    ("3010", "Share Capital", "equity", "Capital", "credit", None, 1, False, "Issued share capital."),
    ("3020", "Additional Paid-In Capital", "equity", "Capital", "credit", None, 1, False, "Share premium / APIC."),
    ("3030", "Owner Capital", "equity", "Capital", "credit", None, 1, False, "Owner/partner capital contributions."),
    ("3040", "Owner Draws", "equity", "Capital", "debit", None, 1, False, "Owner drawings (contra-equity). [Rules §1.1 business entity]"),
    ("3100", "Retained Earnings", "equity", "Retained Earnings", "credit", None, 1, True, "System account for year-end P&L close. [Rules §4.11] [feature-spec]"),
    ("3110", "Revaluation Surplus", "equity", "Reserve", "credit", None, 1, False, "OCI revaluation surplus. [Rules §1.7]"),
    ("3120", "Foreign Currency Translation Reserve", "equity", "Reserve", "credit", None, 1, False, "FCTR for foreign operations. [Rules §1.13]"),
    ("3200", "Dividends Declared", "equity", "Distributions", "debit", None, 1, False, "Dividends declared (contra-equity)."),
    ("3210", "Opening Balance Equity", "equity", "Capital", "credit", None, 1, False, "Temporary equity for opening-balance import. [feature-spec opening balance]"),
    ("4010", "Product Sales Revenue", "income", "Operating Income", "credit", None, 1, False, "Revenue from product sales. [Rules §1.11]"),
    ("4020", "Service Revenue", "income", "Operating Income", "credit", None, 1, False, "Revenue from services."),
    ("4030", "Consulting Revenue", "income", "Operating Income", "credit", None, 1, False, "Consulting and advisory fees."),
    ("4040", "Subscription Revenue", "income", "Operating Income", "credit", None, 1, False, "Recurring subscription income."),
    ("4050", "Free Zone Income", "income", "Operating Income", "credit", None, 1, False, "Qualifying/free zone income. [feature-spec UAE-specific]"),
    ("4060", "Licensing & Royalty Income", "income", "Operating Income", "credit", None, 1, False, "Licensing and royalty income."),
    ("4100", "Sales Returns & Allowances", "income", "Contra-Income", "debit", None, 1, False, "Contra-income for returns/allowances."),
    ("4110", "Sales Discounts", "income", "Contra-Income", "debit", None, 1, False, "Contra-income for sales discounts."),
    ("4510", "Interest Income", "income", "Other Income", "credit", None, 1, False, "Interest earned on deposits/investments."),
    ("4520", "Foreign Exchange Gain", "income", "Other Income", "credit", None, 1, False, "Realized/unrealized FX gains. [Rules §1.13]"),
    ("4530", "Gain on Disposal of Assets", "income", "Other Income", "credit", None, 1, False, "Gain on PP&E disposal. [Rules §3.2]"),
    ("4540", "Rental Income", "income", "Other Income", "credit", None, 1, False, "Income from property rental."),
    ("4550", "Other Income", "income", "Other Income", "credit", None, 1, False, "Miscellaneous other income."),
    ("5010", "Cost of Goods Sold", "expense", "COGS", "debit", None, 1, False, "COGS control. [feature-spec: expense 5000s + sub_category COGS]"),
    ("5011", "Direct Materials", "expense", "COGS", "debit", "5010", 2, False, "Direct materials consumed."),
    ("5012", "Direct Labor", "expense", "COGS", "debit", "5010", 2, False, "Direct production labor."),
    ("5013", "Subcontractor Costs", "expense", "COGS", "debit", "5010", 2, False, "Outsourced direct costs."),
    ("5020", "Import Duty", "expense", "COGS", "debit", None, 1, False, "Import duty on imported goods (Phase 1 interim expense). [feature-spec UAE-specific] [feature-spec product decision 7] TODO(Module 2.2 Inventory): Rules §1.9 — capitalize into inventory cost when inventory costing exists; revisit this account treatment."),
    ("5030", "Freight-In & Customs", "expense", "COGS", "debit", None, 1, False, "Inbound freight and customs (non-duty)."),
    ("5040", "Packaging & Fulfillment", "expense", "COGS", "debit", None, 1, False, "Packaging and fulfillment materials."),
    ("5050", "Inventory Adjustments", "expense", "COGS", "debit", None, 1, False, "Stock count variances / shrinkage. [Rules §1.9]"),
    ("5100", "Salaries & Wages", "expense", "Operating Expenses", "debit", None, 1, False, "Staff salaries and wages. [Rules §1.6]"),
    ("5110", "Employee Benefits", "expense", "Operating Expenses", "debit", None, 1, False, "Non-salary employee benefits."),
    ("5120", "End-of-Service Gratuity Expense", "expense", "Operating Expenses", "debit", None, 1, False, "EOSB/gratuity expense accrual. [Rules §1.6 / §3.11]"),
    ("5130", "Employer Pension Contributions", "expense", "Operating Expenses", "debit", None, 1, False, "Employer statutory pension (e.g. GCC nationals). [Rules §1.6]"),
    ("5200", "Rent Expense", "expense", "Operating Expenses", "debit", None, 1, False, "Facility rent (or short-term/low-value lease expense)."),
    ("5210", "Utilities Expense", "expense", "Operating Expenses", "debit", None, 1, False, "Electricity, water, cooling, etc."),
    ("5220", "Telecommunications & Internet", "expense", "Operating Expenses", "debit", None, 1, False, "Telecom and internet costs."),
    ("5230", "Office Supplies", "expense", "Operating Expenses", "debit", None, 1, False, "Office consumables."),
    ("5300", "Advertising & Marketing", "expense", "Operating Expenses", "debit", None, 1, False, "Advertising and marketing spend."),
    ("5310", "Software & SaaS Subscriptions", "expense", "Operating Expenses", "debit", None, 1, False, "Expensed software subscriptions."),
    ("5400", "Legal & Professional Fees", "expense", "Operating Expenses", "debit", None, 1, False, "Legal and professional fees."),
    ("5410", "Accounting & Audit Fees", "expense", "Operating Expenses", "debit", None, 1, False, "External accounting and audit fees."),
    ("5420", "Bank Charges", "expense", "Operating Expenses", "debit", None, 1, False, "Bank fees and charges."),
    ("5500", "Insurance Expense", "expense", "Operating Expenses", "debit", None, 1, False, "Insurance premiums expensed."),
    ("5510", "Depreciation Expense", "expense", "Operating Expenses", "debit", None, 1, False, "Depreciation of PP&E. [Rules §1.7 / §3.2]"),
    ("5520", "Amortization Expense", "expense", "Operating Expenses", "debit", None, 1, False, "Amortization of intangibles. [Rules §1.8 / §3.3]"),
    ("5530", "Travel & Entertainment", "expense", "Operating Expenses", "debit", None, 1, False, "Travel and entertainment (note VAT blocked categories in Part 2)."),
    ("5540", "Vehicle Running Expenses", "expense", "Operating Expenses", "debit", None, 1, False, "Fuel, maintenance, and vehicle running costs."),
    ("5550", "Repairs & Maintenance", "expense", "Operating Expenses", "debit", None, 1, False, "Repairs and maintenance (non-capital). [Rules §1.7]"),
    ("5560", "Government Fees & Licenses", "expense", "Operating Expenses", "debit", None, 1, False, "Trade license and government fees."),
    ("5600", "Bad Debt Expense", "expense", "Operating Expenses", "debit", None, 1, False, "Bad debt / ECL expense. [Rules §1.4 / §3.6]"),
    ("5610", "Foreign Exchange Loss", "expense", "Operating Expenses", "debit", None, 1, False, "FX losses. [Rules §1.13]"),
    ("5620", "Interest Expense", "expense", "Operating Expenses", "debit", None, 1, False, "Interest on borrowings/leases."),
    ("5630", "Loss on Disposal of Assets", "expense", "Operating Expenses", "debit", None, 1, False, "Loss on PP&E disposal. [Rules §3.2]"),
    ("5640", "Miscellaneous Expenses", "expense", "Operating Expenses", "debit", None, 1, False, "Miscellaneous operating expenses."),
]

REQUIRED_UAE = {
    "VAT Payable", "VAT Receivable", "CT Provision", "Import Duty", "Zakat Reserve", "Free Zone Income",
}


def esc(s: str) -> str:
    return s.replace("'", "''")


def verify() -> None:
    errors: list[str] = []
    nums = [a[0] for a in accounts]
    if len(nums) != len(set(nums)):
        errors.append("duplicate account_numbers")
    by_num = {a[0]: a for a in accounts}
    for a in accounts:
        num, name, cat, _sub, nb, parent, depth, sys, _desc = a
        if num[0] != CAT_PREFIX[cat]:
            errors.append(f"{num}: leading digit mismatch for {cat}")
        if parent is None and depth != 1:
            errors.append(f"{num}: root depth != 1")
        elif parent:
            p = by_num[parent]
            if depth != p[6] + 1:
                errors.append(f"{num}: depth != parent+1")
    missing = REQUIRED_UAE - {a[1] for a in accounts}
    if missing:
        errors.append(f"missing UAE accounts: {missing}")
    zakat = by_num.get("2065")
    if not zakat or zakat[1] != "Zakat Reserve" or zakat[2] != "liability" or zakat[0][0] != "2":
        errors.append("Zakat Reserve placement invalid")
    re = [a for a in accounts if a[1] == "Retained Earnings"]
    if not re or not re[0][7]:
        errors.append("Retained Earnings must be system account")
    total = len(accounts)
    print("=== COA VERIFICATION ===")
    print(f"total_count: {total}")
    print(f"total_count >= 80: {total >= 80}")
    print(f"unique_account_numbers: {len(set(nums)) == total}")
    print(f"leading_digit_matches_category: {not any('leading digit' in e for e in errors)}")
    print(f"parent_depth_plus_one: {not any('depth' in e for e in errors)}")
    print(f"uae_required_accounts: {not missing}")
    print(f"zakat_reserve_liability_2000s: {zakat and zakat[2]=='liability' and zakat[0]=='2065'}")
    print("by_category:", dict(Counter(a[2] for a in accounts)))
    for n in ("1010", "1011", "1012", "2065"):
        a = by_num[n]
        print(f"  {a[0]} {a[1]} cat={a[2]} parent={a[5]} depth={a[6]} nb={a[4]}")
    if errors:
        print("ERRORS:", errors)
        raise SystemExit(1)
    print("ALL CHECKS PASSED")


def write_seed() -> None:
    lines = [
        "-- seed_chart_of_accounts.sql",
        "-- Module 1.1.A UAE Chart of Accounts seed",
        "-- Sources: feature-spec.md (numbering + UAE accounts), Rules §1.2 (structure),",
        "--          Rules §4.11 (Retained Earnings), schema.sql (accounts columns).",
        "-- Excel Chart_of_Accounts used ONLY for column structure — not for account list.",
        "--",
        "-- [feature-spec product decision 6] Demo company fixed UUID for seed only.",
        "-- [feature-spec product decision 8] Zakat Reserve: liability 2000s, name unchanged.",
        "",
        "BEGIN;",
        "",
        "INSERT INTO public.companies (id, legal_name, base_currency, is_free_zone_entity, fiscal_year_start_month)",
        f"VALUES ('{COMPANY_ID}', 'Demo Company (Seed)', 'AED', false, 1)",
        "ON CONFLICT (id) DO NOTHING;",
        "",
        "INSERT INTO public.company_settings (company_id)",
        f"VALUES ('{COMPANY_ID}')",
        "ON CONFLICT (company_id) DO NOTHING;",
        "",
    ]
    for depth in range(1, 5):
        batch = [a for a in accounts if a[6] == depth]
        if not batch:
            continue
        lines.append(f"-- depth {depth} accounts")
        for num, name, cat, sub, nb, parent, depth, sys, desc in batch:
            parent_sql = "NULL"
            if parent:
                parent_sql = (
                    f"(SELECT id FROM public.accounts "
                    f"WHERE company_id = '{COMPANY_ID}' AND account_number = '{parent}')"
                )
            lines.append(
                "INSERT INTO public.accounts ("
                "company_id, account_number, account_name, category, sub_category, "
                "normal_balance, parent_account_id, depth, is_system_account, is_active, description"
                ") VALUES ("
                f"'{COMPANY_ID}', '{num}', '{esc(name)}', '{cat}', '{esc(sub)}', "
                f"'{nb}', {parent_sql}, {depth}, {'true' if sys else 'false'}, true, '{esc(desc)}'"
                ");"
            )
        lines.append("")
    lines.append("COMMIT;")
    lines.append("")
    out = Path("docs/source-of-truth/seed_chart_of_accounts.sql")
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {out}")


def write_verify_sql() -> None:
    sql = f"""-- verify_chart_of_accounts.sql
WITH seed AS (
  SELECT * FROM public.accounts WHERE company_id = '{COMPANY_ID}'
),
checks AS (
  SELECT 'total_count' AS check_name, count(*)::text AS value, (count(*) >= 80) AS pass FROM seed
  UNION ALL
  SELECT 'no_duplicate_account_numbers', count(*)::text, count(*) = 0
  FROM (SELECT account_number FROM seed GROUP BY account_number HAVING count(*) > 1) d
  UNION ALL
  SELECT 'leading_digit_matches_category', count(*)::text, count(*) = 0
  FROM seed s
  WHERE NOT (
    (s.category = 'asset' AND left(s.account_number::text, 1) = '1')
    OR (s.category = 'liability' AND left(s.account_number::text, 1) = '2')
    OR (s.category = 'equity' AND left(s.account_number::text, 1) = '3')
    OR (s.category = 'income' AND left(s.account_number::text, 1) = '4')
    OR (s.category = 'expense' AND left(s.account_number::text, 1) = '5')
  )
  UNION ALL
  SELECT 'parent_depth_plus_one', count(*)::text, count(*) = 0
  FROM seed c JOIN seed p ON c.parent_account_id = p.id WHERE c.depth <> p.depth + 1
  UNION ALL
  SELECT 'zakat_reserve_present_liability', count(*)::text, count(*) = 1
  FROM seed
  WHERE account_name = 'Zakat Reserve'
    AND category = 'liability'
    AND left(account_number::text, 1) = '2'
    AND normal_balance = 'credit'
)
SELECT * FROM checks ORDER BY check_name;
"""
    out = Path("docs/source-of-truth/verify_chart_of_accounts.sql")
    out.write_text(sql, encoding="utf-8")
    print(f"Wrote {out}")


if __name__ == "__main__":
    verify()
    write_seed()
    write_verify_sql()
