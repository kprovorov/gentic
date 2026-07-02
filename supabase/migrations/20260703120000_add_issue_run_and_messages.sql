-- Run state lives directly on the issue (1 issue = 1 run).
alter table public.issues
  add column run_status text,
  add column session_id text,
  add column run_error text,
  add column run_started_at timestamptz,
  add column run_finished_at timestamptz;

alter table public.issues
  add constraint issues_run_status_valid check (
    run_status is null
    or run_status in (
      'queued',
      'cloning',
      'running',
      'completed',
      'failed',
      'cancelled'
    )
  );

-- Chat transcript for an issue's agent run.
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  role text not null,
  kind text not null default 'text',
  content text,
  status text not null default 'complete',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint messages_role_valid check (role in ('user', 'assistant', 'system')),
  constraint messages_kind_valid check (kind in ('text', 'tool', 'thinking')),
  constraint messages_status_valid check (status in ('streaming', 'complete', 'error'))
);

create index messages_issue_id_idx on public.messages(issue_id);

alter table public.messages enable row level security;

grant select, insert, update, delete on public.messages to authenticated;

create policy "Users can read messages for their own issues"
  on public.messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = messages.issue_id
        and projects.user_id = (select auth.uid())
    )
  );

create policy "Users can create messages for their own issues"
  on public.messages
  for insert
  to authenticated
  with check (
    role = 'user'
    and exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = messages.issue_id
        and projects.user_id = (select auth.uid())
    )
  );

create policy "Users can update messages for their own issues"
  on public.messages
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = messages.issue_id
        and projects.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = messages.issue_id
        and projects.user_id = (select auth.uid())
    )
  );

create policy "Users can delete messages for their own issues"
  on public.messages
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = messages.issue_id
        and projects.user_id = (select auth.uid())
    )
  );

-- Realtime: stream transcript inserts/updates and issue run-status changes to the browser.
-- Full replica identity so UPDATE payloads carry issue_id for client-side filtering.
alter table public.messages replica identity full;

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.issues;
