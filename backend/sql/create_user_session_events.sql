/* -- Stores login/logout/autologout actions with timestamp for each user session event.
create table if not exists public.user_session_events (
  id bigint generated always as identity primary key,
  members_id text,
  member_name text,
  mobile text,
  action_type text not null check (action_type in ('login', 'logout', 'autologout')),
  action_at timestamptz not null default now(),
  session_id uuid not null default gen_random_uuid(),
  app_platform text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_user_session_events_members_id
  on public.user_session_events (members_id);

create index if not exists idx_user_session_events_mobile
  on public.user_session_events (mobile);

create index if not exists idx_user_session_events_action_at_desc
  on public.user_session_events (action_at desc);

comment on table public.user_session_events is 'Tracks login lifecycle actions for app users.';
comment on column public.user_session_events.action_type is 'Allowed values: login, logout, autologout.';

 */