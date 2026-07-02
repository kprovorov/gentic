create table public.environments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  ssh_host text,
  ssh_port integer not null default 22,
  ssh_user text,
  public_key text not null,
  private_key text not null,
  last_connection_status text,
  last_connection_message text,
  last_tested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint environments_name_not_blank check (length(trim(name)) between 1 and 120),
  constraint environments_ssh_host_not_blank check (
    ssh_host is null or length(trim(ssh_host)) between 1 and 253
  ),
  constraint environments_ssh_port_range check (ssh_port between 1 and 65535),
  constraint environments_ssh_user_not_blank check (
    ssh_user is null or length(trim(ssh_user)) between 1 and 64
  ),
  constraint environments_connection_status check (
    last_connection_status is null
    or last_connection_status in ('success', 'failed')
  )
);

alter table public.environments enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.environments to authenticated;

create policy "Users can read their own environments"
  on public.environments
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own environments"
  on public.environments
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own environments"
  on public.environments
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own environments"
  on public.environments
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
