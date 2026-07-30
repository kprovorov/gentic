-- A run lease (`active_run_id` + `active_worker_id`) means "a worker is
-- running this issue right now". Only `queued` and `in-progress` are live run
-- statuses; every other status means the run is over and the lease should be
-- gone.
--
-- Releasing it was left to each writer, and the writers disagreed.
-- `finish_issue_run_if_no_pending` and `reconcile_offline_worker_runs` clear
-- it, but the two paths that end a run with a status the worker or the user
-- chooses did not:
--
--   * a worker reporting its own `run-failed`/`held` goes through the generic
--     run-state update in the agent API, which writes only the fields the
--     worker sent;
--   * a user moving an issue from the status dropdown goes through a bare
--     `update public.issues set status = ...`.
--
-- A lease left behind wedges the worker two ways at once. `running_task_count`
-- counts every issue holding a lease, so the dead run occupies a slot forever
-- and the worker stops claiming as soon as that reaches `configured_capacity`
-- (1 by default); and the issue itself becomes unclaimable, because claiming
-- requires `active_run_id is null`. One failed run therefore takes a
-- single-capacity worker out of service permanently, showing "1/1 running"
-- with nothing actually running.
--
-- `ban_worker`/`delete_worker` already carried a special-case cleanup for the
-- `run-failed` half of this. A trigger enforces the invariant for every
-- writer instead, including ones added later.

create or replace function public.release_issue_run_lease()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.active_run_id is not null
     and new.status not in ('queued', 'in-progress') then
    new.active_run_id := null;
    new.active_worker_id := null;
  end if;

  return new;
end;
$$;

drop trigger if exists issues_release_run_lease on public.issues;
create trigger issues_release_run_lease
  before insert or update on public.issues
  for each row
  execute function public.release_issue_run_lease();

-- Repair issues stranded by the old behaviour so their workers get their
-- capacity back without waiting to be banned or re-enrolled.
update public.issues
   set active_run_id = null,
       active_worker_id = null,
       updated_at = now()
 where active_run_id is not null
   and status not in ('queued', 'in-progress');
