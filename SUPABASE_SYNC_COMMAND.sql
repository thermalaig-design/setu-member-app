-- 🚀 SUPABASE QUICK SYNC
-- Marquee banner and trust selector are already shown in navbar (top)
-- home_layout is only for the main content sections below

UPDATE "public"."app_templates" 
SET 
  "home_layout" = '["quickActions", "gallery", "sponsors"]',
  "updated_at" = NOW()
WHERE "template_key" IN ('mah', 'mmpb');

SELECT 
  id,
  name,
  template_key,
  home_layout,
  is_active,
  updated_at
FROM "public"."app_templates"
WHERE template_key IN ('mah', 'mmpb')
ORDER BY updated_at DESC;

-- ✅ Done! Marquee and trust selector are already in navbar.

-- 🔧 Trust List (top selector) enable/disable via feature_flags
-- Enable trust list
-- update public.feature_flags
-- set is_enabled = true
-- where (name = 'feature_trustlist' or features_id in (select id from features where name='feature_trustlist'))
--   and trust_id = '<your_trust_id>';

-- Disable trust list
-- update public.feature_flags
-- set is_enabled = false
-- where (name = 'feature_trustlist' or features_id in (select id from features where name='feature_trustlist'))
--   and trust_id = '<your_trust_id>';

-- 🔧 Quick Access (DB-driven) setup
-- Add columns for route + ordering (run once)
ALTER TABLE public.feature_flags
  ADD COLUMN IF NOT EXISTS route text,
  ADD COLUMN IF NOT EXISTS quick_order int;

-- Set default routes + order for Quick Access tiles
UPDATE public.feature_flags ff
SET route = 'directory', quick_order = 1
FROM public.features f
WHERE ff.features_id = f.id AND f.name = 'feature_directory';

UPDATE public.feature_flags ff
SET route = 'appointment', quick_order = 2
FROM public.features f
WHERE ff.features_id = f.id AND f.name = 'feature_opd';

UPDATE public.feature_flags ff
SET route = 'reports', quick_order = 3
FROM public.features f
WHERE ff.features_id = f.id AND f.name = 'feature_reports';

UPDATE public.feature_flags ff
SET route = 'reference', quick_order = 4
FROM public.features f
WHERE ff.features_id = f.id AND f.name = 'feature_referral';

UPDATE public.feature_flags ff
SET route = 'vip-login', quick_order = 5
FROM public.features f
WHERE ff.features_id = f.id AND f.name = 'feature_vip_login';

UPDATE public.feature_flags ff
SET route = 'notices', quick_order = 6
FROM public.features f
WHERE ff.features_id = f.id AND f.name = 'feature_noticeboard';

-- 🔧 Sponsor (DB-driven) setup
-- 1) Add a sponsor master record
-- Replace <trust_id>, <photo_url>, <about> etc. as needed.
WITH new_sponsor AS (
  INSERT INTO public.sponsors (name, position, about, photo_url, is_active, priority)
  VALUES (
    'Dr. Meena Subhash Gupta',
    'Official Sponsor',
    'Mahila Mandal Punjabi Bagh is a dedicated community initiative.',
    '<photo_url>',
    true,
    10
  )
  RETURNING id
)
-- 2) Link sponsor to trust with an active date range
INSERT INTO public.sponsor_flash (trust_id, sponsor_id, start_date, end_date, is_active)
SELECT
  '<trust_id>',
  id,
  CURRENT_DATE,
  NULL,
  true
FROM new_sponsor;

-- 🔒 Validation: start_date must be <= end_date (when both provided)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sponsor_flash_valid_date_range'
  ) THEN
    ALTER TABLE public.sponsor_flash
      ADD CONSTRAINT sponsor_flash_valid_date_range
      CHECK (
        start_date IS NULL
        OR end_date IS NULL
        OR start_date <= end_date
      );
  END IF;
END $$;



