-- Harden transcript integrity: normal authenticated clients may append their
-- own user messages, but assistant/system transcript rows are append-only and
-- destructive resets are audited through trusted server code.

drop policy if exists "Users can update messages for their own issues"
  on public.messages;
drop policy if exists "Users can delete messages for their own issues"
  on public.messages;

revoke insert, update, delete on public.messages from authenticated;

-- Keep direct client issue edits away from run identity/state fields. Trusted
-- agent/webhook/reset paths use the service role after doing explicit
-- authorization in application code.
revoke update on public.issues from authenticated;
grant update (
  title,
  prompt,
  status,
  agent_provider,
  type,
  updated_at
) on public.issues to authenticated;

create or replace function public.prevent_authenticated_run_identity_changes()
returns trigger
language plpgsql
as $$
begin
  if current_role <> 'authenticated' then
    return new;
  end if;

  if old.session_id is distinct from new.session_id
    or old.active_run_id is distinct from new.active_run_id
    or old.run_error is distinct from new.run_error
    or old.run_started_at is distinct from new.run_started_at
    or old.run_finished_at is distinct from new.run_finished_at
    or old.usage_limit_reset_at is distinct from new.usage_limit_reset_at
    or old.pr_url is distinct from new.pr_url then
    raise exception 'authenticated clients cannot mutate issue run identity fields'
      using errcode = '42501';
  end if;

  if old.run_started_at is not null
    and old.agent_provider is distinct from new.agent_provider then
    raise exception 'authenticated clients cannot change agent provider after run start'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_authenticated_run_identity_changes()
  from public;

drop trigger if exists prevent_authenticated_run_identity_changes
  on public.issues;
create trigger prevent_authenticated_run_identity_changes
  before update on public.issues
  for each row
  execute function public.prevent_authenticated_run_identity_changes();

-- Attachments are immutable metadata rows. The storage object path must live
-- under the same issue id as the metadata row it belongs to.
alter table public.attachments
  add constraint attachments_storage_path_issue_id_matches
  check (split_part(storage_path, '/', 1) = issue_id::text);

drop policy if exists "Users can create attachments for their own issues"
  on public.attachments;

create policy "Users can create attachments for their own issues"
  on public.attachments
  for insert
  to authenticated
  with check (
    split_part(storage_path, '/', 1) = issue_id::text
    and exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = attachments.issue_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

drop policy if exists "Users can upload attachment files for their own issues"
  on storage.objects;

create policy "Users can upload attachment files for their own issues"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and coalesce(array_length(storage.foldername(storage.objects.name), 1), 0) >= 2
    and exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id::text = (storage.foldername(storage.objects.name))[1]
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

create table public.transcript_audit_events (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  actor_user_id text not null,
  operation text not null,
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint transcript_audit_events_operation_valid
    check (operation in ('reset')),
  constraint transcript_audit_events_reason_not_blank
    check (length(trim(reason)) between 1 and 240)
);

create index transcript_audit_events_issue_id_idx
  on public.transcript_audit_events(issue_id);

alter table public.transcript_audit_events enable row level security;

grant select on public.transcript_audit_events to authenticated;
grant select, insert on public.transcript_audit_events to service_role;

create policy "Users can read audit events for their own issues"
  on public.transcript_audit_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = transcript_audit_events.issue_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

create or replace function public.start_issue_from_draft(p_issue_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prompt text;
begin
  if not exists (
    select 1
    from public.issues
    join public.projects on projects.id = issues.project_id
    where issues.id = p_issue_id
      and (
        ((select auth.jwt()) ->> 'role') = 'service_role'
        or projects.user_id = ((select auth.jwt()) ->> 'sub')
      )
  ) then
    raise exception 'Issue not found'
      using errcode = 'P0002';
  end if;

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

  insert into public.messages(issue_id, role, content)
  values (p_issue_id, 'user', coalesce(v_prompt, ''));
end;
$$;

create or replace function public.send_issue_user_message(
  p_issue_id uuid,
  p_content text
)
returns table(id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.issues
    join public.projects on projects.id = issues.project_id
    where issues.id = p_issue_id
      and (
        ((select auth.jwt()) ->> 'role') = 'service_role'
        or projects.user_id = ((select auth.jwt()) ->> 'sub')
      )
  ) then
    raise exception 'Issue not found'
      using errcode = 'P0002';
  end if;

  return query
  with inserted as (
    insert into public.messages(issue_id, role, content)
    values (p_issue_id, 'user', p_content)
    returning messages.id, messages.created_at
  ),
  requeued as (
    update public.issues
    set
      status = 'todo',
      usage_limit_reset_at = null,
      updated_at = now()
    where issues.id = p_issue_id
      and issues.status not in ('draft', 'todo', 'queued', 'held', 'in-progress')
    returning issues.id
  )
  select inserted.id, inserted.created_at
  from inserted;
end;
$$;

revoke all on function public.start_issue_from_draft(uuid)
  from public;
revoke all on function public.send_issue_user_message(uuid, text)
  from public;
grant execute on function public.start_issue_from_draft(uuid)
  to authenticated;
grant execute on function public.start_issue_from_draft(uuid)
  to service_role;
grant execute on function public.send_issue_user_message(uuid, text)
  to authenticated;
grant execute on function public.send_issue_user_message(uuid, text)
  to service_role;

revoke execute on function public.reset_issue_run(uuid, text)
  from authenticated;
revoke execute on function public.reset_issue_run(uuid, text)
  from service_role;

create or replace function public.reset_issue_run_audited(
  p_issue_id uuid,
  p_agent_provider text,
  p_actor_user_id text,
  p_reason text,
  p_source text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prompt text;
  v_previous_agent_provider text;
  v_previous_status text;
  v_deleted_message_count bigint;
begin
  if p_agent_provider not in ('claude_code', 'codex') then
    raise exception 'Invalid agent provider'
      using errcode = '22023';
  end if;

  if length(trim(coalesce(p_actor_user_id, ''))) = 0 then
    raise exception 'Missing reset actor'
      using errcode = '22023';
  end if;

  if length(trim(coalesce(p_reason, ''))) not between 1 and 240 then
    raise exception 'Invalid reset reason'
      using errcode = '22023';
  end if;

  select prompt, agent_provider, status
  into v_prompt, v_previous_agent_provider, v_previous_status
  from public.issues
  where id = p_issue_id;

  if not found then
    raise exception 'Issue not found'
      using errcode = 'P0002';
  end if;

  select count(*)
  into v_deleted_message_count
  from public.messages
  where issue_id = p_issue_id;

  insert into public.transcript_audit_events (
    issue_id,
    actor_user_id,
    operation,
    reason,
    metadata
  )
  values (
    p_issue_id,
    p_actor_user_id,
    'reset',
    p_reason,
    jsonb_build_object(
      'source', p_source,
      'previous_agent_provider', v_previous_agent_provider,
      'next_agent_provider', p_agent_provider,
      'previous_status', v_previous_status,
      'deleted_message_count', v_deleted_message_count
    )
  );

  delete from public.messages
  where issue_id = p_issue_id;

  delete from public.issue_pull_requests
  where issue_id = p_issue_id;

  update public.issues
  set
    status = 'todo',
    agent_provider = p_agent_provider,
    session_id = null,
    active_run_id = null,
    run_error = null,
    run_started_at = null,
    run_finished_at = null,
    usage_limit_reset_at = null,
    pr_url = null,
    updated_at = now()
  where id = p_issue_id;

  insert into public.messages(issue_id, role, content)
  values (p_issue_id, 'user', coalesce(v_prompt, ''));
end;
$$;

revoke all on function public.reset_issue_run_audited(
  uuid,
  text,
  text,
  text,
  text
) from public;
grant execute on function public.reset_issue_run_audited(
  uuid,
  text,
  text,
  text,
  text
) to service_role;
