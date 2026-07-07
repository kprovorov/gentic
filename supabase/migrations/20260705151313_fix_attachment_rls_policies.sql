drop policy if exists "Users can read attachments for their own issues"
  on public.attachments;
drop policy if exists "Users can create attachments for their own issues"
  on public.attachments;
drop policy if exists "Users can delete attachments for their own issues"
  on public.attachments;

drop policy if exists "Users can read attachment files for their own issues"
  on storage.objects;
drop policy if exists "Users can upload attachment files for their own issues"
  on storage.objects;
drop policy if exists "Users can delete attachment files for their own issues"
  on storage.objects;

grant select, insert, delete on public.attachments to authenticated;

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
    bucket_id = 'attachments'
    and exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id::text = (storage.foldername(storage.objects.name))[1]
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

create policy "Users can upload attachment files for their own issues"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id::text = (storage.foldername(storage.objects.name))[1]
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

create policy "Users can delete attachment files for their own issues"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'attachments'
    and exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id::text = (storage.foldername(storage.objects.name))[1]
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );
