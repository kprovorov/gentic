create table public.user_settings (
  user_id text primary key,
  default_agent_provider text not null default 'claude_code',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_settings_default_agent_provider_valid check (
    default_agent_provider in ('claude_code', 'codex')
  )
);

alter table public.user_settings enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update on public.user_settings to authenticated;

create policy "Users can read their own settings"
  on public.user_settings
  for select
  to authenticated
  using (((select auth.jwt()) ->> 'sub') = user_id);

create policy "Users can create their own settings"
  on public.user_settings
  for insert
  to authenticated
  with check (((select auth.jwt()) ->> 'sub') = user_id);

create policy "Users can update their own settings"
  on public.user_settings
  for update
  to authenticated
  using (((select auth.jwt()) ->> 'sub') = user_id)
  with check (((select auth.jwt()) ->> 'sub') = user_id);
