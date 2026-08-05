-- Issue Attachments vs Message Attachments.
--
-- Until now every upload was owned by a chat message: the creation form and
-- the standalone attachment panel both fabricated a `user` message so the file
-- had somewhere to hang, and `reset_issue_run` deletes an issue's messages,
-- which nulls `message_id` (`on delete set null`) and hands the row straight to
-- the orphan sweeper. Files a user attached to the *issue* therefore vanished a
-- day after any agent/conversation reset.
--
-- `kind` splits the two ownerships apart:
--   * 'message' — attached to one chat turn, delivered with that prompt, swept
--     once its message is gone. This is the historical behaviour and stays the
--     default, so existing rows keep exactly the semantics they have today.
--   * 'issue'   — attached to the issue itself, never has a message owner, and
--     survives resets. Only an incomplete upload (or an explicit delete) ever
--     removes one.
--
-- Existing rows are deliberately NOT backfilled or reclassified.
alter table public.attachments
  add column if not exists kind text not null default 'message';

alter table public.attachments
  drop constraint if exists attachments_kind_check;

alter table public.attachments
  add constraint attachments_kind_check
  check (kind in ('issue', 'message'));

-- An Issue Attachment is owned by the issue alone; it must never acquire a
-- message owner (which would make the orphan sweeper eligible to reclaim it).
alter table public.attachments
  drop constraint if exists attachments_issue_kind_has_no_message;

alter table public.attachments
  add constraint attachments_issue_kind_has_no_message
  check (kind <> 'issue' or message_id is null);

create index if not exists attachments_issue_kind_active_idx
  on public.attachments(issue_id, created_at)
  where kind = 'issue' and deleted_at is null;

-- `kind` is intentionally absent from the update grant: a client may finish or
-- delete its own upload, but it may not reclassify an attachment after the
-- fact. Inserts still carry it (the table-level insert grant covers all
-- columns), which is where ownership is decided.
grant update(message_id, upload_completed_at, deleted_at, storage_deleted_at)
  on public.attachments
  to authenticated;

-- Cleanup: only a Message Attachment is "orphaned" by losing its message.
-- Issue Attachments are orphaned only while their upload never completed.
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
     where (
             upload_completed_at is null
             or (kind = 'message' and message_id is null)
           )
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
   where (
           upload_completed_at is null
           or (kind = 'message' and message_id is null)
         )
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
