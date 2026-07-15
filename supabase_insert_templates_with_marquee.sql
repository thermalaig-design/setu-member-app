-- Complete INSERT statements - home_layout for main content area only
-- NOTE: Marquee banner and trust selector are already in navbar, not in home_layout

-- For MAH Classic template
INSERT INTO "public"."app_templates" 
(
  "id", "name", "description", "primary_color", "secondary_color", "accent_color", 
  "accent_bg", "navbar_bg", "page_bg", "home_layout", "animations", "custom_css", 
  "is_active", "created_at", "updated_at", "template_key"
) 
VALUES 
(
  '7da04276-0348-4df8-a4d8-ac9a29d9470c',
  'MAH Classic',
  'MAH SETU — Navy Blue, Clean White, Quick Actions first',
  '#1B2A6B',
  '#2D3A8C',
  '#E8EAFF',
  '#F0F2FF',
  'rgba(255,255,255,0.95)',
  'linear-gradient(160deg,#f8f9ff 0%,#ffffff 50%,#f0f2ff 100%)',
  '["quickActions", "gallery", "sponsors"]',
  '{"cards": "fadeUp", "navbar": "fadeSlideDown", "gallery": "zoomIn"}',
  '',
  true,
  '2026-04-04 18:22:04.443381+00',
  NOW(),
  'mah'
)
ON CONFLICT ("id") DO UPDATE SET
  "home_layout" = '["quickActions", "gallery", "sponsors"]',
  "updated_at" = NOW();


-- For Mahila Mandal Classic template
INSERT INTO "public"."app_templates" 
(
  "id", "name", "description", "primary_color", "secondary_color", "accent_color", 
  "accent_bg", "navbar_bg", "page_bg", "home_layout", "animations", "custom_css", 
  "is_active", "created_at", "updated_at", "template_key"
) 
VALUES 
(
  'f7735e03-8f72-4923-af22-44a64342a6cf',
  'Mahila Mandal Classic',
  'Mahila Mandal Punjabi Bagh — Red & Navy, Gallery top',
  '#C0241A',
  '#2B2F7E',
  '#FDECEA',
  '#EAEBF8',
  'rgba(234,235,248,0.88)',
  'linear-gradient(160deg,#fff5f5 0%,#ffffff 50%,#f0f1fb 100%)',
  '["quickActions", "gallery", "sponsors"]',
  '{"cards": "fadeUp", "navbar": "fadeSlideDown", "gallery": "zoomIn"}',
  '',
  true,
  '2026-04-04 17:37:54.154156+00',
  NOW(),
  'mmpb'
)
ON CONFLICT ("id") DO UPDATE SET
  "home_layout" = '["quickActions", "gallery", "sponsors"]',
  "updated_at" = NOW();


-- Verify both templates are updated
SELECT 
  id,
  name,
  template_key,
  home_layout,
  is_active,
  updated_at
FROM "public"."app_templates"
WHERE template_key IN ('mah', 'mmpb')
ORDER BY created_at DESC;

