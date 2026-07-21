-- `finish_issue_run_if_no_pending` only allowed `ready-for-review` and
-- `waiting-for-input` as terminal run statuses. The run-state route now also
-- finishes a run into `testing` when the opened PR has CI checks configured,
-- so it can wait for the github webhook to resolve it to `ready-for-review`
-- or `tests-failed` instead of jumping straight to `ready-for-review`.
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
  if p_status not in ('ready-for-review', 'waiting-for-input', 'testing') then
    raise exception 'Invalid terminal run status'
      using errcode = '22023';
  end if;

  update public.issues
  set
    status = p_status,
    run_finished_at = p_run_finished_at,
    pr_url = coalesce(p_pr_url, pr_url),
    active_run_id = null,
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
