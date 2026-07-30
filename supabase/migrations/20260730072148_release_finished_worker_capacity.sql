-- A worker assignment and a run lease are one lifecycle. Older run-release
-- functions predate active_worker_id, so they could clear active_run_id while
-- leaving the worker attached. That orphaned assignment was then counted
-- against worker capacity and prevented the worker from claiming more work.

update public.issues
   set active_worker_id = null
 where active_worker_id is not null
   and active_run_id is null;

alter table public.issues
  add constraint issues_active_worker_requires_active_run check (
    active_worker_id is null or active_run_id is not null
  );

create or replace function public.finish_issue_run_if_no_pending(
  p_issue_id uuid,
  p_run_id uuid,
  p_status text,
  p_run_finished_at timestamptz,
  p_pr_url text default null
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_status not in ('ready-for-review', 'waiting-for-input') then
    raise exception 'Invalid terminal run status'
      using errcode = '22023';
  end if;

  update public.issues
  set
    status = p_status,
    run_finished_at = p_run_finished_at,
    pr_url = coalesce(p_pr_url, pr_url),
    active_run_id = null,
    active_worker_id = null,
    updated_at = now()
  where id = p_issue_id
    and active_run_id = p_run_id
    and not exists (
      select 1
      from public.messages
      where messages.issue_id = p_issue_id
        and messages.role = 'user'
        and messages.consumed_by_run_id is null
    );

  return found;
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
declare
  v_prompt text;
begin
  if p_agent_provider not in ('claude_code', 'codex') then
    raise exception 'Invalid agent provider'
      using errcode = '22023';
  end if;

  if p_issue_model is not null and char_length(p_issue_model) not between 1 and 100 then
    raise exception 'Invalid issue model'
      using errcode = '22023';
  end if;

  select prompt into v_prompt
  from public.issues
  where id = p_issue_id;

  if not found then
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

  insert into public.messages(issue_id, role, content)
  values (p_issue_id, 'user', coalesce(v_prompt, ''));
end;
$$;
