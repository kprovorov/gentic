create table public.github_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  installation_id text,
  setup_action text,
  status text not null default 'connected',
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint github_integrations_user_id_unique unique (user_id),
  constraint github_integrations_status_check check (status in ('connected', 'pending')),
  constraint github_integrations_connected_installation_check check (
    status <> 'connected' or installation_id is not null
  )
);

create table public.github_integration_states (
  state text primary key,
  user_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index github_integrations_user_id_idx
  on public.github_integrations(user_id);

create index github_integration_states_user_id_idx
  on public.github_integration_states(user_id);

create index github_integration_states_expires_at_idx
  on public.github_integration_states(expires_at);

alter table public.github_integrations enable row level security;
alter table public.github_integration_states enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.github_integrations to authenticated;
grant select, insert, update, delete on public.github_integration_states to authenticated;

create policy "Users can read their own GitHub integration"
  on public.github_integrations
  for select
  to authenticated
  using (((select auth.jwt()) ->> 'sub') = user_id);

create policy "Users can create their own GitHub integration"
  on public.github_integrations
  for insert
  to authenticated
  with check (((select auth.jwt()) ->> 'sub') = user_id);

create policy "Users can update their own GitHub integration"
  on public.github_integrations
  for update
  to authenticated
  using (((select auth.jwt()) ->> 'sub') = user_id)
  with check (((select auth.jwt()) ->> 'sub') = user_id);

create policy "Users can delete their own GitHub integration"
  on public.github_integrations
  for delete
  to authenticated
  using (((select auth.jwt()) ->> 'sub') = user_id);

create policy "Users can read their own GitHub setup states"
  on public.github_integration_states
  for select
  to authenticated
  using (((select auth.jwt()) ->> 'sub') = user_id);

create policy "Users can create their own GitHub setup states"
  on public.github_integration_states
  for insert
  to authenticated
  with check (((select auth.jwt()) ->> 'sub') = user_id);

create policy "Users can delete their own GitHub setup states"
  on public.github_integration_states
  for delete
  to authenticated
  using (((select auth.jwt()) ->> 'sub') = user_id);
