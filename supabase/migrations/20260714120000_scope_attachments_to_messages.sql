alter table public.attachments
  add column if not exists message_id uuid references public.messages(id) on delete set null,
  add column if not exists deleted_at timestamptz,
  add column if not exists storage_deleted_at timestamptz;

create index if not exists attachments_message_id_idx
  on public.attachments(message_id);

create index if not exists attachments_issue_message_active_idx
  on public.attachments(issue_id, message_id, created_at)
  where deleted_at is null;

update public.attachments
   set message_id = (
    select messages.id
      from public.messages
     where messages.issue_id = attachments.issue_id
       and messages.role = 'user'
     order by messages.created_at asc
     limit 1
   )
 where attachments.message_id is null
   and exists (
    select 1
      from public.messages
     where messages.issue_id = attachments.issue_id
       and messages.role = 'user'
   );

grant update(message_id, deleted_at, storage_deleted_at) on public.attachments
  to authenticated;

create or replace function public.ensure_attachment_message_issue()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.message_id is not null and not exists (
    select 1
      from public.messages
     where messages.id = new.message_id
       and messages.issue_id = new.issue_id
  ) then
    raise exception 'Attachment message must belong to the same issue'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists ensure_attachment_message_issue
  on public.attachments;

create trigger ensure_attachment_message_issue
  before insert or update of issue_id, message_id
  on public.attachments
  for each row
  execute function public.ensure_attachment_message_issue();

create policy "Users can update attachments for their own issues"
  on public.attachments
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = attachments.issue_id
        and projects.user_id = (select auth.uid())::text
    )
  )
  with check (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = attachments.issue_id
        and projects.user_id = (select auth.uid())::text
    )
  );

alter table public.attachments
  add constraint attachments_size_bytes_limit
  check (size_bytes is null or size_bytes <= 26214400)
  not valid;

create or replace function public.delete_old_orphaned_attachments(
  older_than interval default interval '1 day'
)
returns table(storage_path text)
language sql
security invoker
set search_path = public
as $$
  update public.attachments
     set deleted_at = coalesce(deleted_at, now())
   where message_id is null
     and created_at < now() - older_than
     and deleted_at is null
  returning attachments.storage_path;
$$;

create or replace function public.delete_orphaned_attachment_rows(
  older_than interval default interval '7 days'
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.attachments
   where message_id is null
     and deleted_at is not null
     and storage_deleted_at is not null
     and created_at < now() - older_than;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

grant execute on function public.delete_old_orphaned_attachments(interval)
  to authenticated;
grant execute on function public.delete_orphaned_attachment_rows(interval)
  to authenticated;

grant execute on function public.ensure_attachment_message_issue()
  to authenticated;
