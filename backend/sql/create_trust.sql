-- Create Trust table
CREATE TABLE IF NOT EXISTS public."Trust" (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  icon_url text NULL,
  remark text NULL,
  developer_mobile text NULL,
  developer_secret_code text NULL,
  secret_code text NULL,
  created_at timestamp with time zone NULL DEFAULT now(),
  terms_content text NULL,
  privacy_content text NULL,
  CONSTRAINT trust_pkey PRIMARY KEY (id)
) TABLESPACE pg_default;

-- Seed initial data
INSERT INTO public."Trust" (id,name,icon_url,remark,created_at,terms_content,privacy_content) VALUES
('7dfd3e03-7ff9-4543-9485-e169a4586738','TEI','https://i.postimg.cc/TwTHRtkp/Flame-gear-and-insulation-logo.png','Thermal Engineers and Insulators','2026-03-16 05:43:31.128718+00',NULL,NULL),
('91d2cd2f-c2c2-437e-a58b-ef505272002d','KAMDHENU HOSPITAL','https://kamdhenumangalparivar.org/resource/Image/logo.png','Trustee and Patron Portal','2026-03-12 09:50:23.941891+00',NULL,NULL),
('a0e3922f-a5e6-4b1e-87d0-59f80adb5af9','MAHARAJA AGRASEN HOSPITAL','https://www.mahdelhi.org/images/mahRound100.png','Welcome to our portal','2026-03-11 10:34:37.149655+00',
'<h1>Terms & Conditions</h1>...','<h1>Privacy Policy</h1>...'),
('b353d2ff-ec3b-4b90-a896-69f40662084e','Mahila Mandal',NULL,NULL,'2026-03-31 12:08:25.897841+00',NULL,NULL)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Feature catalog (controls which UI capabilities can be toggled)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.features (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subname text NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  remarks text NULL,
  CONSTRAINT features_pkey PRIMARY KEY (id),
  CONSTRAINT features_name_key UNIQUE (name)
) TABLESPACE pg_default;

-- ---------------------------------------------------------------------------
-- Feature flags (per trust + tier)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feature_flags (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  features_id uuid NOT NULL,
  trust_id uuid NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  tier text NOT NULL DEFAULT 'general'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  name text NULL,
  description text NULL,
  trust_name text NULL,
  display_name text NULL,
  tagline text NULL,
  icon_url text NULL,
  route text NULL,
  quick_order integer NULL,
  CONSTRAINT feature_flags_pkey PRIMARY KEY (id),
  CONSTRAINT feature_flags_unique UNIQUE (features_id, trust_id, tier),
  CONSTRAINT feature_flags_features_id_fkey FOREIGN KEY (features_id) REFERENCES public.features (id) ON DELETE CASCADE,
  CONSTRAINT feature_flags_trust_fkey FOREIGN KEY (trust_id) REFERENCES public."Trust" (id) ON DELETE CASCADE,
  CONSTRAINT feature_flags_tier_check CHECK ((tier = ANY (ARRAY['general'::text, 'vip'::text])))
) TABLESPACE pg_default;

-- Base app feature keys
INSERT INTO public.features (name, subname, remarks)
VALUES
  ('feature_directory', 'Directory', 'Controls directory access'),
  ('feature_marquee', 'Marquee Updates', 'Controls marquee banner updates'),
  ('feature_notifications', 'Notifications', 'Controls notification center UI and route'),
  ('feature_events', 'Events Tile', 'Controls quick access events tile'),
  ('feature_noticeboard', 'Noticeboard', 'Controls quick access noticeboard tile and notices route'),
  ('feature_gallery', 'Gallery', 'Controls gallery section and route'),
  ('feature_sponsors', 'Sponsors', 'Controls sponsor section'),
  ('feature_opd', 'OPD', 'Controls OPD schedule route'),
  ('feature_reports', 'Reports', 'Controls reports route'),
  ('feature_referral', 'Referral', 'Controls patient referral route'),
  ('feature_share_app', 'Share App', 'Controls share app action'),
  ('feature_profile', 'Profile', 'Controls profile route'),
  ('feature_developer_info', 'Developer Info', 'Controls developer details route'),
  ('feature_add_community', 'Add Community', 'Controls add community sidebar item and route'),
  ('feature_nomination_details', 'Nomination Details', 'Controls nomination details sidebar item and route'),
  ('feature_doctors', 'Doctors', 'Controls doctor directory tab'),
  ('feature_hospitals', 'Hospitals', 'Controls hospital directory tab'),
  ('feature_committee', 'Committee', 'Controls committee directory tab'),
  ('feature_elected_members', 'Elected Members', 'Controls elected members directory tab')
ON CONFLICT (name) DO NOTHING;

-- Create default GENERAL flags for every feature in every trust (enabled by default)
INSERT INTO public.feature_flags (features_id, trust_id, is_enabled, tier, name, description, trust_name)
SELECT
  f.id,
  t.id,
  true,
  'general',
  f.subname,
  f.remarks,
  t.name
FROM public.features f
CROSS JOIN public."Trust" t
WHERE NOT EXISTS (
  SELECT 1
  FROM public.feature_flags ff
  WHERE ff.features_id = f.id
    AND ff.trust_id = t.id
    AND ff.tier = 'general'
);

-- Nomination Details should exist for every trust but stay enabled only for Udaan.
UPDATE public.feature_flags ff
SET
  is_enabled = CASE
    WHEN t.name ILIKE '%udaan%' THEN true
    ELSE false
  END,
  display_name = COALESCE(ff.display_name, 'Nomination Details'),
  description = COALESCE(ff.description, 'Sidebar feature for nomination details'),
  route = COALESCE(ff.route, 'nomination-details'),
  updated_at = now()
FROM public.features f
JOIN public."Trust" t
  ON t.id = ff.trust_id
WHERE ff.features_id = f.id
  AND f.name = 'feature_nomination_details'
  AND ff.tier = 'general';

UPDATE public.feature_flags ff
SET
  display_name = COALESCE(ff.display_name, 'Add Community'),
  description = COALESCE(ff.description, 'Sidebar feature for add community'),
  route = COALESCE(ff.route, 'add-community'),
  quick_order = COALESCE(ff.quick_order, 45),
  updated_at = now()
FROM public.features f
WHERE ff.features_id = f.id
  AND f.name = 'feature_add_community'
  AND ff.tier = 'general';
