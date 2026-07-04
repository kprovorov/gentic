-- Private bucket for files attached to issues. Objects are stored under
-- `${issue_id}/${attachment_id}-${file_name}`, so the first path segment ties
-- an object back to its owning issue for the RLS policies below.
insert into storage.buckets (id, name, public, file_size_limit)
values ('issue-attachments', 'issue-attachments', false, 52428800)
on conflict (id) do nothing;

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  file_name text not null,
  content_type text,
  size_bytes bigint,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

create index attachments_issue_id_idx on public.attachments(issue_id);

alter table public.attachments enable row level security;

grant select, insert, delete on public.attachments to authenticated;

-- User ids are Clerk subjects (see `projects_user_id_to_clerk`), read out of
-- the verified JWT via auth.jwt()->>'sub' rather than auth.uid().
create policy "Users can read attachments for their own issues"
  on public.attachments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = attachments.issue_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

create policy "Users can create attachments for their own issues"
  on public.attachments
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = attachments.issue_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

create policy "Users can delete attachments for their own issues"
  on public.attachments
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = attachments.issue_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

create policy "Users can read attachment files for their own issues"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'issue-attachments'
    and exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id::text = (storage.foldername(name))[1]
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

create policy "Users can upload attachment files for their own issues"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'issue-attachments'
    and exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id::text = (storage.foldername(name))[1]
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

create policy "Users can delete attachment files for their own issues"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'issue-attachments'
    and exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id::text = (storage.foldername(name))[1]
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

-- Realtime: stream attachment inserts/deletes to the browser like messages.
alter table public.attachments replica identity full;

alter publication supabase_realtime add table public.attachments;
