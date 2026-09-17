"""Generate the demo COA seed + verify SQL from the finalized UAE COA Excel.

Writes:
  - docs/source-of-truth/seed_finalized_coa_demo_company_0002.sql
  - docs/source-of-truth/verify_chart_of_accounts.sql

Sources:
  - docs/source-of-truth/Chart of Accounts - inFINity.xlsx ("Chart of Accounts" sheet)
  - feature-spec.md decisions #5, #6, #12–#17
"""
from __future__ import annotations

from collections import Counter
from pathlib import Path

import openpyxl

# [feature-spec.md decision #17] Second fixed demo company — ...0001 is retired.
COMPANY_ID = "00000000-0000-0000-0000-000000000002"
COMPANY_LEGAL_NAME = "Demo Company (Finalized COA Seed)"
XLSX = Path("docs/source-of-truth/Chart of Accounts - inFINity.xlsx")
VERIFY_OUT = Path("docs/source-of-truth/verify_chart_of_accounts.sql")
SEED_OUT = Path("docs/source-of-truth/seed_finalized_coa_demo_company_0002.sql")

CAT_PREFIX = {
    "asset": "1",
    "liability": "2",
    "equity": "3",
    "income": "4",
    "expense": "5",
}

BAND_TO_CATEGORY = {
    "1000s - Assets": "asset",
    "2000s - Liabilities": "liability",
    "3000s - Equity": "equity",
    "4000s - Income": "income",
    "5000s - Expenses": "expense",
}

# [feature-spec.md decision #15] Hierarchy demos — net-new, not in Excel.
HIERARCHY_DEMOS = [
    # (number, name, category, sub_category, normal_balance, parent, depth, is_system, is_active, description)
    (
        "1021",
        "Bank Account - Current (AED) - Operations",
        "asset",
        "Cash & Bank",
        "debit",
        "1020",
        2,
        False,
        True,
        "[Detail] Hierarchy demo child of 1020. [feature-spec.md decision #15]",
    ),
    (
        "1022",
        "Bank Account - Current (AED) - Payroll Disbursement",
        "asset",
        "Cash & Bank",
        "debit",
        "1020",
        2,
        False,
        True,
        "[Detail] Hierarchy demo child of 1020. [feature-spec.md decision #15]",
    ),
    (
        "5101",
        "Salaries & Wages Expense - Head Office",
        "expense",
        "Payroll",
        "debit",
        "5100",
        2,
        False,
        True,
        "[Detail] Hierarchy demo child of 5100. [feature-spec.md decision #15]",
    ),
    (
        "5102",
        "Salaries & Wages Expense - Head Office - Management",
        "expense",
        "Payroll",
        "debit",
        "5101",
        3,
        False,
        True,
        "[Detail] Hierarchy demo child of 5101. [feature-spec.md decision #15]",
    ),
]

# [feature-spec-1_1_F.md F-41] Additive COA at F build (slots empty in Excel).
F41_ACCOUNTS = [
    (
        "1415",
        "VAT Receivable, Bad Debt Relief",
        "asset",
        "Tax Recoverable",
        "debit",
        None,
        1,
        False,
        True,
        "[Detail][feature-spec-1_1_F.md F-41] recoverable VAT slice of written-off invoices",
    ),
    (
        "5641",
        "Bad Debt Recovery",
        "expense",
        "Depreciation & Amortization",
        "credit",
        None,
        1,
        False,
        True,
        "[Contra-Expense][feature-spec-1_1_F.md F-41] credit side of VAT bad-debt relief",
    ),
]


def esc(s: str) -> str:
    return s.replace("'", "''")


def blank(value) -> bool:
    if value is None:
        return True
    text = str(value).strip()
    return text == ""


def vat_blank(value) -> bool:
    """Treat empty and Excel 'N/A' as absent VAT mapping (decision #14 examples omit N/A)."""
    if blank(value):
        return True
    return str(value).strip().upper() == "N/A"


def build_description(nature, vat, notes) -> str | None:
    # [feature-spec.md decision #14]
    parts: list[str] = []
    if not blank(nature):
        parts.append(f"[{str(nature).strip()}]")
    if not vat_blank(vat):
        parts.append(f"[{str(vat).strip()}]")
    note_text = "" if blank(notes) else str(notes).strip()
    if not parts and not note_text:
        return None
    prefix = "".join(parts)
    if prefix and note_text:
        return f"{prefix} {note_text}"
    return prefix or note_text


def band_to_category(band: str) -> str:
    cat = BAND_TO_CATEGORY.get(str(band).strip())
    if not cat:
        raise ValueError(f"Unrecognized Band value: {band!r}")
    return cat


def normal_balance_from_excel(value: str) -> str:
    # [feature-spec.md decision #5] lowercase enum literals only
    raw = str(value).strip()
    if raw == "Dr":
        return "debit"
    if raw == "Cr":
        return "credit"
    raise ValueError(f"Unrecognized Normal Balance: {value!r}")


def default_active_from_excel(value: str) -> bool:
    raw = str(value).strip().upper()
    if raw == "Y":
        return True
    if raw == "N":
        return False
    raise ValueError(f"Unrecognized Default Active: {value!r}")


def load_accounts_from_excel() -> list[tuple]:
    wb = openpyxl.load_workbook(XLSX, data_only=True)
    ws = wb["Chart of Accounts"]
    accounts: list[tuple] = []

    for row in ws.iter_rows(min_row=2, values_only=True):
        code, name, band, sub, nb, nature, vat, _uae, active, notes = row
        if code is None:
            continue
        num = str(int(code)).zfill(4) if isinstance(code, (int, float)) else str(code).strip()
        category = band_to_category(band)
        is_system = num == "3100"  # [feature-spec.md decision #16]
        accounts.append(
            (
                num,
                str(name).strip(),
                category,
                str(sub).strip(),
                normal_balance_from_excel(nb),
                None,  # parent
                1,  # depth — Excel rows are roots; hierarchy demos add depth
                is_system,
                default_active_from_excel(active),
                build_description(nature, vat, notes),
            )
        )

    return accounts


def merge_with_hierarchy(excel_accounts: list[tuple]) -> list[tuple]:
    by_num = {a[0]: a for a in excel_accounts}
    for demo in HIERARCHY_DEMOS:
        if demo[0] in by_num:
            raise ValueError(f"Hierarchy demo account {demo[0]} already exists in Excel COA")
        parent = demo[5]
        if parent not in by_num:
            raise ValueError(f"Hierarchy demo parent {parent} missing from Excel COA")
        by_num[demo[0]] = demo
    for extra in F41_ACCOUNTS:
        if extra[0] in by_num:
            raise ValueError(f"F-41 account {extra[0]} already exists in Excel COA")
        by_num[extra[0]] = extra
    return list(by_num.values())


def verify(accounts: list[tuple]) -> None:
    errors: list[str] = []
    nums = [a[0] for a in accounts]
    if len(nums) != len(set(nums)):
        errors.append("duplicate account_numbers")
    if len(accounts) != 186:
        errors.append(f"expected 186 accounts (180 Excel + 4 hierarchy + F-41 1415/5641), got {len(accounts)}")
    if "1350" not in {a[0] for a in accounts}:
        errors.append("missing 1350 Supplier Advances [feature-spec-1_1_E.md E-23]")
    if "1415" not in {a[0] for a in accounts} or "5641" not in {a[0] for a in accounts}:
        errors.append("missing 1415/5641 VAT bad-debt relief accounts [feature-spec-1_1_F.md F-41]")

    by_num = {a[0]: a for a in accounts}
    for a in accounts:
        num, _name, cat, _sub, nb, parent, depth, _sys, _active, _desc = a
        if num[0] != CAT_PREFIX[cat]:
            errors.append(f"{num}: leading digit mismatch for {cat}")
        if parent is None and depth != 1:
            errors.append(f"{num}: root depth != 1")
        elif parent:
            p = by_num[parent]
            if depth != p[6] + 1:
                errors.append(f"{num}: depth != parent+1")
        if nb not in ("debit", "credit"):
            errors.append(f"{num}: normal_balance must be lowercase debit/credit")

    re = by_num.get("3100")
    if not re or re[1] != "Retained Earnings" or not re[7]:
        errors.append("3100 Retained Earnings must be is_system_account=true")

    for code in ("1021", "1022", "5101", "5102"):
        if code not in by_num:
            errors.append(f"missing hierarchy demo {code}")

    zakat_payable = by_num.get("2350")
    if not zakat_payable or zakat_payable[1] != "Zakat Payable" or zakat_payable[2] != "liability":
        errors.append("2350 Zakat Payable missing/invalid")
    zakat_reserve = by_num.get("3300")
    if (
        not zakat_reserve
        or "Zakat Reserve" not in zakat_reserve[1]
        or zakat_reserve[2] != "equity"
        or zakat_reserve[8] is not False
    ):
        errors.append("3300 Zakat Reserve equity non-default missing/invalid")

    import_duty_liab = by_num.get("2800")
    import_duty_exp = by_num.get("5030")
    if not import_duty_liab or import_duty_liab[2] != "liability":
        errors.append("2800 Import Duty Payable missing")
    if not import_duty_exp or import_duty_exp[2] != "expense":
        errors.append("5030 Import Duty & Customs Clearance missing")

    print("=== COA VERIFICATION ===")
    print(f"total_count: {len(accounts)}")
    print(f"unique_account_numbers: {len(set(nums)) == len(accounts)}")
    print(f"leading_digit_matches_category: {not any('leading digit' in e for e in errors)}")
    print(f"parent_depth_plus_one: {not any('depth' in e for e in errors)}")
    print(f"3100_is_system_account: {bool(re and re[7])}")
    print(f"default_active_true: {sum(1 for a in accounts if a[8])}")
    print(f"default_active_false: {sum(1 for a in accounts if not a[8])}")
    print("by_category:", dict(Counter(a[2] for a in accounts)))
    for n in ("1020", "1021", "1022", "3100", "5100", "5101", "5102", "2350", "3300", "2800", "5030"):
        a = by_num[n]
        print(
            f"  {a[0]} {a[1]} cat={a[2]} parent={a[5]} depth={a[6]} "
            f"sys={a[7]} active={a[8]} nb={a[4]}"
        )
    if errors:
        print("ERRORS:", errors)
        raise SystemExit(1)
    print("ALL CHECKS PASSED")


def sql_null_or_str(value: str | None) -> str:
    if value is None:
        return "NULL"
    return f"'{esc(value)}'"


def write_seed(accounts: list[tuple]) -> None:
    lines = [
        "-- seed_finalized_coa_demo_company_0002.sql",
        "-- [feature-spec.md decision #17] Apply this file in Supabase to mint the demo company.",
        "-- INSERT-ONLY — does not touch 00000000-0000-0000-0000-000000000001.",
        "--",
        "-- Module 1.1.A UAE Chart of Accounts seed (finalized 180-account COA + 4 hierarchy demos + F-41 1415/5641 = 186)",
        "-- [feature-spec-1_1_E.md E-23] adds 1350 Supplier Advances (not 1320)",
        "-- [feature-spec-1_1_F.md F-41] adds 1415 / 5641 VAT bad-debt relief",
        "-- Source: Chart of Accounts - inFINity.xlsx → \"Chart of Accounts\" sheet",
        "-- [feature-spec.md decision #5] normal_balance lowercase debit/credit only",
        "-- [feature-spec.md decision #6] Demo company fixed UUID for seed only",
        "-- [feature-spec.md decision #17] Active demo company is ...0002;",
        "--          ...0001 is retired legacy placeholder-era data (do not modify).",
        "-- [feature-spec.md decision #12–#13] Zakat 2350/3300 + Import Duty 2800/5030 as in source",
        "-- [feature-spec.md decision #14] Account Nature + VAT Mapping + Notes → description",
        "-- [feature-spec.md decision #15] Hierarchy demos 1021/1022/5101/5102",
        "-- [feature-spec.md decision #16] 3100 Retained Earnings is_system_account = true",
        "--",
        "-- INSERT-ONLY: does not DELETE or touch company ...0001.",
        "",
        "BEGIN;",
        "",
        "INSERT INTO public.companies (id, legal_name, base_currency, is_free_zone_entity, fiscal_year_start_month)",
        f"VALUES ('{COMPANY_ID}', '{esc(COMPANY_LEGAL_NAME)}', 'AED', false, 1)",
        "ON CONFLICT (id) DO NOTHING;",
        "",
        "INSERT INTO public.company_settings (company_id)",
        f"VALUES ('{COMPANY_ID}')",
        "ON CONFLICT (company_id) DO NOTHING;",
        "",
    ]

    for depth in range(1, 5):
        batch = sorted((a for a in accounts if a[6] == depth), key=lambda a: a[0])
        if not batch:
            continue
        lines.append(f"-- depth {depth} accounts")
        for num, name, cat, sub, nb, parent, depth_v, sys, active, desc in batch:
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
                f"'{nb}', {parent_sql}, {depth_v}, "
                f"{'true' if sys else 'false'}, {'true' if active else 'false'}, "
                f"{sql_null_or_str(desc)}"
                ");"
            )
        lines.append("")

    lines.append("COMMIT;")
    lines.append("")
    SEED_OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {SEED_OUT} ({len(accounts)} accounts)")


def write_verify_sql() -> None:
    sql = f"""-- verify_chart_of_accounts.sql
-- Stage 1 verification against finalized UAE COA seed (186 rows)
WITH seed AS (
  SELECT * FROM public.accounts WHERE company_id = '{COMPANY_ID}'
),
checks AS (
  SELECT 'total_count' AS check_name, count(*)::text AS value, (count(*) = 186) AS pass FROM seed
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
  SELECT 'retained_earnings_3100_system', count(*)::text, count(*) = 1
  FROM seed
  WHERE account_number = '3100'
    AND account_name = 'Retained Earnings'
    AND is_system_account = true
  UNION ALL
  SELECT 'normal_balance_lowercase', count(*)::text, count(*) = 0
  FROM seed
  WHERE normal_balance::text NOT IN ('debit', 'credit')
  UNION ALL
  SELECT 'hierarchy_demo_count', count(*)::text, count(*) = 4
  FROM seed
  WHERE account_number IN ('1021', '1022', '5101', '5102')
)
SELECT * FROM checks ORDER BY check_name;
"""
    VERIFY_OUT.write_text(sql, encoding="utf-8")
    print(f"Wrote {VERIFY_OUT}")


if __name__ == "__main__":
    excel_accounts = load_accounts_from_excel()
    print(f"Loaded {len(excel_accounts)} accounts from Excel")
    accounts = merge_with_hierarchy(excel_accounts)
    verify(accounts)
    write_seed(accounts)
    write_verify_sql()
