alter table public.attachments
  add column if not exists message_id uuid references public.messages(id) on delete set null,
  add column if not exists upload_completed_at timestamptz,
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

update public.attachments
   set upload_completed_at = coalesce(upload_completed_at, created_at)
 where upload_completed_at is null
   and deleted_at is null;

grant update(message_id, upload_completed_at, deleted_at, storage_deleted_at)
  on public.attachments
  to authenticated;

create or replace function public.ensure_attachment_message_issue()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if split_part(new.storage_path, '/', 1) <> new.issue_id::text then
    raise exception 'Attachment storage path must start with the issue id'
      using errcode = '23514';
  end if;

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
  before insert or update of issue_id, message_id, storage_path
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
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  )
  with check (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = attachments.issue_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

alter table public.attachments
  add constraint attachments_size_bytes_limit
  check (size_bytes is null or size_bytes <= 26214400)
  not valid;

create or replace function public.start_issue_from_draft(p_issue_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prompt text;
begin
  update public.issues
  set
    status = 'todo',
    usage_limit_reset_at = null,
    updated_at = now()
  where id = p_issue_id
    and status = 'draft'
  returning prompt into v_prompt;

  if not found then
    raise exception 'Issue is not a draft or was not found'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1
      from public.messages
     where messages.issue_id = p_issue_id
       and messages.role = 'user'
  ) then
    insert into public.messages(issue_id, role, content)
    values (p_issue_id, 'user', coalesce(v_prompt, ''));
  end if;
end;
$$;

create or replace function public.delete_old_orphaned_attachments(
  older_than interval default interval '1 day'
)
returns table(storage_path text)
language sql
security invoker
set search_path = public
as $$
  with newly_deleted as (
    update public.attachments
       set deleted_at = coalesce(deleted_at, now())
     where (message_id is null or upload_completed_at is null)
       and created_at < now() - older_than
       and deleted_at is null
    returning attachments.storage_path
  )
  select newly_deleted.storage_path
    from newly_deleted
  union
  select attachments.storage_path
    from public.attachments
   where attachments.deleted_at is not null
     and attachments.storage_deleted_at is null
     and attachments.created_at < now() - older_than;
$$;

create or replace function public.mark_attachment_storage_deleted(
  storage_paths text[]
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated_count integer;
begin
  update public.attachments
     set storage_deleted_at = coalesce(storage_deleted_at, now())
   where storage_path = any(storage_paths)
     and deleted_at is not null;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
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
   where (message_id is null or upload_completed_at is null)
     and deleted_at is not null
     and storage_deleted_at is not null
     and created_at < now() - older_than;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

grant execute on function public.delete_old_orphaned_attachments(interval)
  to authenticated;
grant execute on function public.mark_attachment_storage_deleted(text[])
  to authenticated;
grant execute on function public.delete_orphaned_attachment_rows(interval)
  to authenticated;

grant execute on function public.ensure_attachment_message_issue()
  to authenticated;
