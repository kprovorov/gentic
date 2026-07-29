-- Atomically records an automatic create-PR request for an issue's active
-- run and, the first time it succeeds for that run, inserts the visible
-- Gentic-authored `role='user'` message that carries the instruction into
-- the run's live prompt stream (picked up the same way a human chat message
-- would be, so the worker never has to leave `in-progress`/wait state).
--
-- Concurrency/idempotency: the `issue_automatic_pr_requests_issue_run_unique`
-- constraint is the source of truth. `insert ... on conflict do nothing`
-- lets exactly one caller win the race (or a worker restart replaying the
-- same run) and insert the message; every other caller — concurrent or a
-- later retry — falls through to the `select` below and gets back the
-- winner's existing request/message untouched. The
-- `ensure_issue_automatic_pr_request_active_run` trigger (added in
-- 20260729102215) rejects the insert outright when `p_run_id` is no longer
-- the issue's `active_run_id`, covering stale/superseded/cross-worker calls.
create or replace function public.request_automatic_pr_publish(
  p_issue_id uuid,
  p_run_id uuid,
  p_content text
)
returns table(
  request_id uuid,
  message_id uuid,
  status text,
  created boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_request_id uuid;
  v_message_id uuid;
  v_status text;
begin
  insert into public.issue_automatic_pr_requests(issue_id, run_id, status)
  values (p_issue_id, p_run_id, 'pending')
  on conflict (issue_id, run_id) do nothing
  returning id into v_request_id;

  if v_request_id is not null then
    insert into public.messages(issue_id, role, kind, content, author_type, generated_action)
    values (p_issue_id, 'user', 'text', p_content, 'gentic', 'create_pr')
    returning id into v_message_id;

    update public.issue_automatic_pr_requests
       set requested_by_message_id = v_message_id
     where id = v_request_id
    returning status into v_status;

    return query select v_request_id, v_message_id, v_status, true;
    return;
  end if;

  select id, requested_by_message_id, status
    into v_request_id, v_message_id, v_status
    from public.issue_automatic_pr_requests
   where issue_id = p_issue_id
     and run_id = p_run_id;

  if not found then
    -- No existing row and nothing was inserted: the active-run trigger
    -- rejected the insert with its own exception before we get here, so
    -- this branch only guards against an unexpected empty result.
    raise exception 'Automatic pull request must target the issue active run'
      using errcode = '23514';
  end if;

  return query select v_request_id, v_message_id, v_status, false;
end;
$$;

revoke all on function public.request_automatic_pr_publish(uuid, uuid, text)
  from public;

grant execute on function public.request_automatic_pr_publish(uuid, uuid, text)
  to service_role;

-- `request_automatic_pr_publish` backfills `requested_by_message_id` with a
-- plain `UPDATE` after it wins the insert race. That `UPDATE` re-fires this
-- trigger (`before ... update of ... requested_by_message_id`), which by
-- default re-validates `active_run_id` against a fresh snapshot — so an
-- unrelated, unlucky concurrent change to the issue's active run (e.g. a
-- manual reset) landing in the narrow window between the two statements
-- would raise here and roll back the whole call, discarding the request and
-- message the same call already legitimately inserted. The row already
-- passed this check once at insert time, so skip re-checking it for an
-- update that only touches `requested_by_message_id` on an otherwise
-- unchanged row.
create or replace function public.ensure_issue_automatic_pr_request_active_run()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_create_pr_automatically boolean;
begin
  if tg_op = 'UPDATE'
     and new.issue_id = old.issue_id
     and new.run_id = old.run_id then
    -- Same row, not retargeting the run: keep the snapshot this row already
    -- captured at insert time instead of re-deriving (and re-validating)
    -- it against the issue's current state.
    new.create_pr_automatically_snapshot = old.create_pr_automatically_snapshot;
  else
    select issues.create_pr_automatically into v_create_pr_automatically
        from public.issues
       where issues.id = new.issue_id
         and issues.active_run_id = new.run_id;

    if not found then
      raise exception 'Automatic pull request must target the issue active run'
        using errcode = '23514';
    end if;

    new.create_pr_automatically_snapshot = v_create_pr_automatically;
  end if;

  if new.requested_by_message_id is not null and not exists (
    select 1
      from public.messages
     where messages.id = new.requested_by_message_id
       and messages.issue_id = new.issue_id
       and messages.generated_action = 'create_pr'
  ) then
    raise exception 'Create PR request message must belong to the issue and be marked as create_pr'
      using errcode = '23514';
  end if;

  new.updated_at = now();
  return new;
end;
$$;
