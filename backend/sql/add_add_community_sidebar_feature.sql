INSERT INTO public.features (name, subname, remarks)
VALUES (
  'feature_add_community',
  'Add Community',
  'Controls add community sidebar item and route'
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
  true,
  'general',
  f.name,
  f.remarks,
  t.name,
  'Add Community',
  'add-community',
  45
FROM public.features f
CROSS JOIN public."Trust" t
WHERE f.name = 'feature_add_community'
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
