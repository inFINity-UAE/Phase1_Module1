-- verify_chart_of_accounts.sql
-- Stage 1 verification against finalized UAE COA seed (186 rows)
WITH seed AS (
  SELECT * FROM public.accounts WHERE company_id = '00000000-0000-0000-0000-000000000002'
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
