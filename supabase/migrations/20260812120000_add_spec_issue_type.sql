-- Spec issue type.
--
-- A Spec documents intent instead of requesting work: no worker ever claims it
-- and it has no agent conversation. The claim query filters `type <> 'spec'`,
-- but the three functions that open an agent run or add to its transcript are
-- the durable boundary, so each rejects a Spec outright — a Spec that somehow
-- reaches `todo` still never starts a run or grows a transcript.

alter table public.issues
  drop constraint issues_type_valid;

alter table public.issues
  add constraint issues_type_valid check (
    type in ('issue', 'feature', 'bug', 'feedback', 'idea', 'spec')
  );

create or replace function public.start_issue_from_draft(p_issue_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if exists (
    select 1 from public.issues
     where id = p_issue_id
       and type = 'spec'
  ) then
    raise exception 'Spec issues do not run a coding agent'
      using errcode = '22023';
  end if;

  update public.issues
  set
    status = 'todo',
    usage_limit_reset_at = null,
    updated_at = now()
  where id = p_issue_id
    and status = 'draft';

  if not found then
    raise exception 'Issue is not a draft or was not found'
      using errcode = 'P0002';
  end if;

  -- Idempotent across re-queues: only seed the Kickoff Message when the issue
  -- has no user message yet, so a draft started twice (or claimed after a
  -- follow-up already landed) never gets a duplicate.
  if not exists (
    select 1
      from public.messages
     where messages.issue_id = p_issue_id
       and messages.role = 'user'
  ) then
    insert into public.messages(issue_id, role, author_type, content)
    values (
      p_issue_id,
      'user',
      'gentic',
      public.issue_kickoff_message(p_issue_id)
    );
  end if;
end;
$$;

create or replace function public.reset_issue_run(
  p_issue_id uuid,
  p_agent_provider text,
  p_issue_model text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_agent_provider not in ('claude_code', 'codex') then
    raise exception 'Invalid agent provider'
      using errcode = '22023';
  end if;

  if p_issue_model is not null and char_length(p_issue_model) not between 1 and 100 then
    raise exception 'Invalid issue model'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.issues where id = p_issue_id
  ) then
    raise exception 'Issue not found'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.issues
     where id = p_issue_id
       and type = 'spec'
  ) then
    raise exception 'Spec issues do not run a coding agent'
      using errcode = '22023';
  end if;

  delete from public.messages
  where issue_id = p_issue_id;

  delete from public.issue_pull_requests
  where issue_id = p_issue_id;

  update public.issues
  set
    status = 'todo',
    agent_provider = p_agent_provider,
    issue_model = p_issue_model,
    session_id = null,
    active_run_id = null,
    active_worker_id = null,
    run_error = null,
    run_started_at = null,
    run_finished_at = null,
    usage_limit_reset_at = null,
    pr_url = null,
    updated_at = now()
  where id = p_issue_id;

  insert into public.messages(issue_id, role, author_type, content)
  values (
    p_issue_id,
    'user',
    'gentic',
    public.issue_kickoff_message(p_issue_id)
  );
end;
$$;

create or replace function public.send_issue_user_message(
  p_issue_id uuid,
  p_content text
)
returns table(id uuid, created_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
begin
  if exists (
    select 1 from public.issues
     where issues.id = p_issue_id
       and issues.type = 'spec'
  ) then
    raise exception 'Spec issues have no agent conversation'
      using errcode = '22023';
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
