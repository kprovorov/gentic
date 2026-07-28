alter table public.issues
  add column issue_model text;

alter table public.issues
  add constraint issues_issue_model_valid check (
    issue_model is null or char_length(issue_model) between 1 and 100
  );

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
