
ALTER TABLE public.feature_flags
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS tagline text,
  ADD COLUMN IF NOT EXISTS icon_url text,
  ADD COLUMN IF NOT EXISTS route text,
  ADD COLUMN IF NOT EXISTS quick_order integer;

INSERT INTO public.features (name, subname, remarks)
VALUES (
  'feature_nomination_details',
  'Nomination Details',
  'Controls nomination details sidebar item and route'
)
ON CONFLICT (name) DO UPDATE
SET
  subname = EXCLUDED.subname,
  remarks = EXCLUDED.remarks,
  updated_at = now();

INSERT INTO public.feature_flags (
  features_id,
  trust_id,
  is_enabled,
  tier,
  name,
  description,
  trust_name,
  display_name,
  route,
  quick_order
)
SELECT
  f.id,
  t.id,
  CASE
    WHEN t.name ILIKE '%udaan%' THEN true
    ELSE false
  END,
  'general',
  f.name,
  f.remarks,
  t.name,
  'Nomination Details',
  'nomination-details',
  35
FROM public.features f
CROSS JOIN public."Trust" t
WHERE f.name = 'feature_nomination_details'
ON CONFLICT (features_id, trust_id, tier) DO UPDATE
SET
  is_enabled = EXCLUDED.is_enabled,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trust_name = EXCLUDED.trust_name,
  display_name = EXCLUDED.display_name,
  route = EXCLUDED.route,
  quick_order = EXCLUDED.quick_order,
  updated_at = now();
