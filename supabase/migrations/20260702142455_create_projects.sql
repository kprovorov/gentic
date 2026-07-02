create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  repo text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_name_not_blank check (length(trim(name)) between 1 and 120),
  constraint projects_repo_format check (
    repo ~ '^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$'
  ),
  constraint projects_user_repo_unique unique (user_id, repo)
);

alter table public.projects enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.projects to authenticated;

create policy "Users can read their own projects"
  on public.projects
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own projects"
  on public.projects
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own projects"
  on public.projects
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own projects"
  on public.projects
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
