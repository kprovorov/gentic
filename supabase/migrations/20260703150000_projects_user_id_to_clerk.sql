-- Clerk (not Supabase Auth) now issues the JWTs behind Supabase's Data API,
-- via Supabase's Third-Party Auth integration. Clerk user ids are strings
-- like "user_2NNy..." rather than UUIDs, so projects.user_id moves from
-- uuid (FK to auth.users, which no longer holds these users) to plain text.
-- Every RLS policy that compared against auth.uid() now reads the Clerk user
-- id out of the verified JWT via auth.jwt()->>'sub' instead.
--
-- All policies that depend on projects.user_id — including the issues and
-- messages policies, which reference it through a subquery — must be dropped
-- before the column type can change, not just the ones defined on projects
-- itself. Recreate them all afterwards.

alter table public.projects
  drop constraint projects_user_id_fkey;

drop policy "Users can read their own projects" on public.projects;
drop policy "Users can create their own projects" on public.projects;
drop policy "Users can update their own projects" on public.projects;
drop policy "Users can delete their own projects" on public.projects;

drop policy "Users can read issues for their own projects" on public.issues;
drop policy "Users can create issues for their own projects" on public.issues;
drop policy "Users can update issues for their own projects" on public.issues;
drop policy "Users can delete issues for their own projects" on public.issues;

drop policy "Users can read messages for their own issues" on public.messages;
drop policy "Users can create messages for their own issues" on public.messages;
drop policy "Users can update messages for their own issues" on public.messages;
drop policy "Users can delete messages for their own issues" on public.messages;

alter table public.projects
  alter column user_id type text using user_id::text;

create policy "Users can read their own projects"
  on public.projects
  for select
  to authenticated
  using (((select auth.jwt()) ->> 'sub') = user_id);

create policy "Users can create their own projects"
  on public.projects
  for insert
  to authenticated
  with check (((select auth.jwt()) ->> 'sub') = user_id);

create policy "Users can update their own projects"
  on public.projects
  for update
  to authenticated
  using (((select auth.jwt()) ->> 'sub') = user_id)
  with check (((select auth.jwt()) ->> 'sub') = user_id);

create policy "Users can delete their own projects"
  on public.projects
  for delete
  to authenticated
  using (((select auth.jwt()) ->> 'sub') = user_id);

-- Issues policies join through projects.user_id.
create policy "Users can read issues for their own projects"
  on public.issues
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.projects
      where projects.id = issues.project_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

create policy "Users can create issues for their own projects"
  on public.issues
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.projects
      where projects.id = issues.project_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

create policy "Users can update issues for their own projects"
  on public.issues
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.projects
      where projects.id = issues.project_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  )
  with check (
    exists (
      select 1
      from public.projects
      where projects.id = issues.project_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

create policy "Users can delete issues for their own projects"
  on public.issues
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.projects
      where projects.id = issues.project_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

-- Messages policies join through issues -> projects.user_id.
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
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
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
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
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
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  )
  with check (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = messages.issue_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
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
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );
