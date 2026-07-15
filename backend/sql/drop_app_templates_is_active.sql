-- Remove legacy template activity flag.
-- Runtime theme linking now resolves strictly via Trust.template_id -> app_templates.id.
alter table if exists public.app_templates
drop column if exists is_active;

