-- Bug Fix: Legacy fallback fetchLatestActiveTemplateForTrust returns the template
-- with the LATEST updated_at. Since "ek udaan official theme" was updated more
-- recently than "theme 1", the fallback always returns the official theme
-- even when Trust.template_id explicitly points to "theme 1".
--
-- Fix: Set is_active = false on templates that are NOT the primary linked one.
-- The Trust table's template_id = 243a402f-33e2-4e4c-a18c-a032db17fd56 (theme 1)
-- so mark the old "ek udaan official theme" as inactive.

UPDATE app_templates
SET is_active = false
WHERE id = 'd1511357-16e9-4782-a32e-0e1537f6519f';  -- "ek udaan official theme" (old)

-- Confirm theme 1 is still active
UPDATE app_templates
SET is_active = true
WHERE id = '243a402f-33e2-4e4c-a18c-a032db17fd56';  -- "theme 1" (currently linked)
