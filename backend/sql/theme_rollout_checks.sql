-- Theme Rollout Checks
-- Run these queries before production rollout or after template changes.

-- 1. Trusts with missing template links
select
  t.id,
  t.name,
  t.template_id
from public."Trust" t
where t.template_id is null
order by t.name;

-- 2. Trusts pointing to a missing template
select
  t.id as trust_id,
  t.name as trust_name,
  t.template_id as missing_template_id
from public."Trust" t
left join public.app_templates at on at.id = t.template_id
where t.template_id is not null
  and at.id is null
order by t.name;

-- 3. Templates not linked by any trust
select
  at.id,
  at.name,
  at.template_key,
  at.trust_id,
  at.updated_at
from public.app_templates at
left join public."Trust" t on t.template_id = at.id
where t.id is null
order by at.updated_at desc nulls last;

-- 4. Templates linked by multiple trusts
select
  at.id,
  at.name,
  count(t.id) as linked_trust_count,
  array_agg(t.name order by t.name) as linked_trust_names
from public.app_templates at
join public."Trust" t on t.template_id = at.id
group by at.id, at.name
having count(t.id) > 1
order by linked_trust_count desc, at.name;

-- 5. Template owner mismatch visibility
-- Note: this can be intentional for shared/base templates.
select
  t.id as trust_id,
  t.name as trust_name,
  at.id as template_id,
  at.name as template_name,
  at.trust_id as template_owner_trust_id
from public."Trust" t
join public.app_templates at on at.id = t.template_id
where at.trust_id is not null
  and at.trust_id <> t.id
order by t.name;

-- 6. Templates missing core theme data
select
  at.id,
  at.name,
  at.template_key,
  at.updated_at
from public.app_templates at
where at.theme_config is null
order by at.updated_at desc nulls last;
