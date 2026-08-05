-- The Issue's durable work statement is its Body, not a "prompt": the prompt
-- is what a worker sends to the coding agent, while this column is the
-- human-authored statement of the work. Rename the column (data-preserving)
-- and recreate the two functions that read it, since plpgsql bodies are
-- stored as text and are not rewritten by `alter table ... rename column`.

alter table public.issues rename column prompt to body;

create or replace function public.start_issue_from_draft(p_issue_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_body text;
begin
  update public.issues
  set
    status = 'todo',
    usage_limit_reset_at = null,
    updated_at = now()
  where id = p_issue_id
    and status = 'draft'
  returning body into v_body;

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
    values (p_issue_id, 'user', coalesce(v_body, ''));
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
declare
  v_body text;
begin
  if p_agent_provider not in ('claude_code', 'codex') then
    raise exception 'Invalid agent provider'
      using errcode = '22023';
  end if;

  if p_issue_model is not null and char_length(p_issue_model) not between 1 and 100 then
    raise exception 'Invalid issue model'
      using errcode = '22023';
  end if;

  select body into v_body
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
  values (p_issue_id, 'user', coalesce(v_body, ''));
end;
$$;
