-- Remove legacy trust-link table after migrating all reads to reg_members.
-- Run this only after deploying application code that no longer depends on member_trust_links.

begin;

drop table if exists public.member_trust_links;

commit;
