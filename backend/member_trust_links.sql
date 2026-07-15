-- Create member_trust_links table
create table public.member_trust_links (
  id uuid not null default gen_random_uuid (),
  member_id uuid not null,
  trust_id uuid not null,
  membership_no text not null,
  location text null,
  remark1 text null,
  remark2 text null,
  is_active boolean null default true,
  created_at timestamp with time zone null default now(),
  constraint member_trust_links_pkey primary key (id),
  constraint unique_member_per_trust unique (member_id, trust_id),
  constraint member_trust_links_member_id_fkey foreign key (member_id) references "Members" (members_id) on delete cascade,
  constraint member_trust_links_trust_id_fkey foreign key (trust_id) references "Trust" (id) on delete cascade
) tablespace pg_default;

-- Create indexes for better query performance
create index if not exists idx_mtl_member_id on public.member_trust_links using btree (member_id) tablespace pg_default;
create index if not exists idx_mtl_trust_id on public.member_trust_links using btree (trust_id) tablespace pg_default;
create index if not exists idx_mtl_is_active on public.member_trust_links using btree (is_active) tablespace pg_default;
