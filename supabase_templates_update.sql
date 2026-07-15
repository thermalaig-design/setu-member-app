-- Update MAH Classic template - home_layout is for main content only
-- Marquee and trust selector are already in navbar at top
UPDATE "public"."app_templates" 
SET 
  "home_layout" = '["quickActions", "gallery", "sponsors"]',
  "updated_at" = NOW()
WHERE "template_key" = 'mah'
  AND "id" = '7da04276-0348-4df8-a4d8-ac9a29d9470c';

-- Update Mahila Mandal Classic template
UPDATE "public"."app_templates" 
SET 
  "home_layout" = '["quickActions", "gallery", "sponsors"]',
  "updated_at" = NOW()
WHERE "template_key" = 'mmpb'
  AND "id" = 'f7735e03-8f72-4923-af22-44a64342a6cf';

-- Verify the update
SELECT 
  id,
  name,
  template_key,
  home_layout,
  updated_at
FROM "public"."app_templates"
WHERE template_key IN ('mah', 'mmpb')
ORDER BY created_at DESC;

