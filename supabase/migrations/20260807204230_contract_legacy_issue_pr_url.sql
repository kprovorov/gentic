-- Preserve any value written during the expand/migrate compatibility window.
-- The URL constraint makes this safe to replay, while the sticky association
-- created by a signed webhook remains authoritative on a conflicting URL.
insert into public.issue_pull_requests (issue_id, url)
select issues.id, issues.pr_url
  from public.issues
 where issues.pr_url is not null
on conflict (url) do nothing;

-- Worker completion stopped accepting PR URLs before contraction. Replace the
-- compatibility overload with the association-only contract used by callers.
drop function public.finish_issue_run_if_no_pending(
  uuid,
  uuid,
  text,
  timestamptz,
  text
);

create function public.finish_issue_run_if_no_pending(
  p_issue_id uuid,
  p_run_id uuid,
  p_status text,
  p_run_finished_at timestamptz
)
returns table (
  finished boolean,
  status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_aggregate record;
begin
  if p_status not in ('ready-for-review', 'waiting-for-input') then
    raise exception 'Invalid terminal run status'
      using errcode = '22023';
  end if;

  select issues.status
    into v_status
    from public.issues
   where issues.id = p_issue_id
     and issues.active_run_id = p_run_id
   for update;

  if not found then
    return query
      select false, issues.status
        from public.issues
       where issues.id = p_issue_id;
    return;
  end if;

  if exists (
    select 1
      from public.messages
     where messages.issue_id = p_issue_id
       and messages.role = 'user'
       and messages.consumed_by_run_id is null
  ) then
    return query select false, v_status;
    return;
  end if;

  update public.issues
     set status = p_status,
         run_finished_at = p_run_finished_at,
         active_run_id = null,
         active_worker_id = null,
         updated_at = now()
   where id = p_issue_id;

  select *
    into v_aggregate
    from public.recompute_issue_status_from_pull_requests(p_issue_id);

  return query
    select true, coalesce(v_aggregate.next_status, p_status);
end;
$$;

revoke all on function public.finish_issue_run_if_no_pending(
  uuid,
  uuid,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.finish_issue_run_if_no_pending(
  uuid,
  uuid,
  text,
  timestamptz
) to service_role;

-- Reset keeps deleting Associated Pull Requests intentionally: an explicit
-- reset starts a fresh agent conversation and association lifecycle.
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

alter table public.issues drop column pr_url;
