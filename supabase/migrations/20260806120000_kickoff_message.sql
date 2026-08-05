-- Kickoff Message.
--
-- A fresh conversation no longer starts by copying the Issue Body into the
-- transcript. Instead it opens with a single, fixed, human-visible line —
-- `Work on Gentic issue {Issue Code}.` — stored as a user-role message that is
-- Gentic-authored. The Coding Agent reads the Body itself through the Gentic
-- MCP `get_issue` tool, so the Body no longer has to be smuggled into the
-- prompt.
--
-- Only the two lifecycle boundaries that create a fresh conversation seed it:
-- an initial draft start (`start_issue_from_draft`) and an explicit agent
-- reset (`reset_issue_run`). Retries, resumed sessions, follow-up messages, and
-- pending-message delivery reuse the existing transcript and never create a
-- second Kickoff Message.

-- Single source of truth for the Kickoff Message text, so both lifecycle
-- functions (and any future caller) format the Issue Code identically to
-- `getIssueCode` in @gentic/services.
create or replace function public.issue_kickoff_message(p_issue_id uuid)
returns text
language sql
security invoker
set search_path = public
as $$
  select 'Work on Gentic issue ' || p.key || '-' || i.number || '.'
    from public.issues i
    join public.projects p on p.id = i.project_id
   where i.id = p_issue_id;
$$;

create or replace function public.start_issue_from_draft(p_issue_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
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

-- Drop the obsolete pre-`issue_model` two-argument overload. It was superseded
-- by the three-argument version (with `p_issue_model default null`) but never
-- removed, so it lingered with the old Body-copy behaviour and made a
-- two-positional-argument call ambiguous. Every caller passes all three named
-- arguments, so removing it is safe.
drop function if exists public.reset_issue_run(uuid, text);

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
