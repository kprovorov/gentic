create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'todo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_title_not_blank check (length(trim(title)) between 1 and 160),
  constraint tasks_status_valid check (status in ('todo', 'in-progress', 'done'))
);

create index tasks_project_id_idx on public.tasks(project_id);

alter table public.tasks enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;

create policy "Users can read tasks for their own projects"
  on public.tasks
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.projects
      where projects.id = tasks.project_id
        and projects.user_id = (select auth.uid())
    )
  );

create policy "Users can create tasks for their own projects"
  on public.tasks
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.projects
      where projects.id = tasks.project_id
        and projects.user_id = (select auth.uid())
    )
  );

create policy "Users can update tasks for their own projects"
  on public.tasks
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.projects
      where projects.id = tasks.project_id
        and projects.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.projects
      where projects.id = tasks.project_id
        and projects.user_id = (select auth.uid())
    )
  );

create policy "Users can delete tasks for their own projects"
  on public.tasks
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.projects
      where projects.id = tasks.project_id
        and projects.user_id = (select auth.uid())
    )
  );
