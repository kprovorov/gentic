-- Generic, extensible events log for the issue-detail activity timeline.
-- Additive only: nothing writes or reads this table yet, that lands in
-- follow-up issues.
create table public.issue_events (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index issue_events_issue_id_idx
  on public.issue_events(issue_id, created_at);

grant select, insert on public.issue_events to authenticated;

alter table public.issue_events enable row level security;

-- User ids are Clerk subjects, read out of the verified JWT via
-- auth.jwt()->>'sub' rather than auth.uid().
create policy "Users can read events for their own issues"
  on public.issue_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = issue_events.issue_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

create policy "Users can create events for their own issues"
  on public.issue_events
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = issue_events.issue_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

-- Realtime: stream new events to the browser like messages/attachments.
alter table public.issue_events replica identity full;

alter publication supabase_realtime add table public.issue_events;
