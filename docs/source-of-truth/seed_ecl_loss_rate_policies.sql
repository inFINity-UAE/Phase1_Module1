-- seed_ecl_loss_rate_policies.sql
-- [feature-spec-1_1_D.md §4.5 / D-8]
--
-- PROVISIONAL industry-benchmark rates — NOT company-calibrated, NOT ratified.
-- Reassess yearly against real write-off history (D-8 review cadence).
-- Do NOT seed customers.ecl_override_rate or a non-zero 1110 opening balance
-- (§4.5: overrides start empty; allowance builds from AED 0).
--
-- Applies one rate row per bucket to every existing company.
-- ON CONFLICT DO NOTHING — safe to re-run; never overwrites a later calibrated rate
-- with the same (company_id, bucket, effective_from).
--
-- created_by = fixed seed actor UUID (not a login) — same convention as other
-- system-authored seed rows.

INSERT INTO public.ecl_loss_rate_policies (
  company_id, bucket, loss_rate, effective_from, created_by
)
SELECT
  c.id,
  v.bucket,
  v.loss_rate,
  date '2026-01-01',
  '00000000-0000-0000-0000-0000000000d0'::uuid
FROM public.companies c
CROSS JOIN (
  VALUES
    -- provisional midpoints from §4.5 benchmark ranges (loss_rate is 0–1, not %)
    ('current',  0.0075),  -- 0.75%
    ('0_30',     0.0200),  -- 2%
    ('31_60',    0.0750),  -- 7.5%
    ('61_90',    0.2000),  -- 20%
    ('90_plus',  0.4000)   -- 40%
) AS v(bucket, loss_rate)
ON CONFLICT (company_id, bucket, effective_from) DO NOTHING;
