-- Reset has been failing outright since the Spec migration
-- (20260812120000_add_spec_issue_type.sql). That migration re-declared
-- `reset_issue_run` from a copy of the body that predated
-- 20260807204230_contract_legacy_issue_pr_url.sql, so it reinstated
-- `pr_url = null` in the issue update after that column had been dropped.
-- plpgsql resolves column references at execution rather than creation time,
-- so the stale reference raised `undefined_column` (42703) on every call and
-- the whole reset rolled back — the user confirmed the dialog and nothing
-- changed.
--
-- Same body as the Spec version, minus the dropped column. Associated Pull
-- Requests are still deleted on purpose: a reset starts a fresh agent
-- conversation and a fresh association lifecycle (review cycles hang off
-- `issue_pull_requests` and cascade with it).
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
