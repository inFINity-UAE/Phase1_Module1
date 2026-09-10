-- seed_uae_public_holidays.sql
-- [feature-spec-1_1_D.md §3.1b / D-14]
-- UAE-wide public holidays (company_id IS NULL), remainder of 2026 through 2029.
--
-- CONFIRMED — fixed Gregorian dates from Cabinet Resolution No. (27) of 2024 Art.1.
-- PROVISIONAL — Hijri holidays projected by scripts/hijri_holiday_projection.py
--   (Umm al-Qura / Meeus); re-run that script to regenerate the lunar block.
--
-- ON CONFLICT DO NOTHING — re-run never overwrites a row already corrected to
-- CONFIRMED (or any other edit). Conflict target is public_holidays_uae_date_uq.
--
-- Expected counts: 11 CONFIRMED + 27 PROVISIONAL = 38 rows.

INSERT INTO public.public_holidays (company_id, holiday_date, description, status, source)
VALUES
  -- CONFIRMED (Gregorian / Article 1 fixed)
  (NULL, '2026-12-02', 'National Day (Eid Al Etihad)', 'CONFIRMED', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2026-12-03', 'National Day (Eid Al Etihad)', 'CONFIRMED', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2027-01-01', 'Gregorian New Year', 'CONFIRMED', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2027-12-02', 'National Day (Eid Al Etihad)', 'CONFIRMED', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2027-12-03', 'National Day (Eid Al Etihad)', 'CONFIRMED', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2028-01-01', 'Gregorian New Year', 'CONFIRMED', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2028-12-02', 'National Day (Eid Al Etihad)', 'CONFIRMED', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2028-12-03', 'National Day (Eid Al Etihad)', 'CONFIRMED', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2029-01-01', 'Gregorian New Year', 'CONFIRMED', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2029-12-02', 'National Day (Eid Al Etihad)', 'CONFIRMED', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2029-12-03', 'National Day (Eid Al Etihad)', 'CONFIRMED', 'Cabinet Resolution 27/2024 Art.1'),

  -- PROVISIONAL (from scripts/hijri_holiday_projection.py — self-check passed)
  (NULL, '2027-03-09', 'Eid Al Fitr', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2027-03-10', 'Eid Al Fitr', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2027-03-11', 'Eid Al Fitr', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2027-05-15', 'Arafah Day', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2027-05-16', 'Eid Al Adha', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2027-05-17', 'Eid Al Adha', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2027-05-18', 'Eid Al Adha', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2027-06-06', 'Hijri New Year', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2027-08-14', 'Prophet Mohammed''s Birthday', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2028-02-26', 'Eid Al Fitr', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2028-02-27', 'Eid Al Fitr', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2028-02-28', 'Eid Al Fitr', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2028-05-04', 'Arafah Day', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2028-05-05', 'Eid Al Adha', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2028-05-06', 'Eid Al Adha', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2028-05-07', 'Eid Al Adha', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2028-05-25', 'Hijri New Year', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2028-08-03', 'Prophet Mohammed''s Birthday', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2029-02-14', 'Eid Al Fitr', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2029-02-15', 'Eid Al Fitr', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2029-02-16', 'Eid Al Fitr', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2029-04-23', 'Arafah Day', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2029-04-24', 'Eid Al Adha', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2029-04-25', 'Eid Al Adha', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2029-04-26', 'Eid Al Adha', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2029-05-14', 'Hijri New Year', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1'),
  (NULL, '2029-07-24', 'Prophet Mohammed''s Birthday', 'PROVISIONAL', 'Cabinet Resolution 27/2024 Art.1')
ON CONFLICT DO NOTHING;
