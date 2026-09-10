-- A stalled reviewer is invisible to every existing recovery path: as long
-- as a `review_runs` row is still `pending`/`running`, the cycle is not
-- "stuck" (ADR-0004's derived definition), so `retry_review_run` refuses it
-- and the Retry control never renders.
--
-- The automatic safety nets do not close the gap either.
-- `reconcile_offline_review_runs` fails a `running` run once its host OR the
-- run itself has been silent for 5 minutes, but the host's run heartbeat is
-- a plain `setInterval` in `processReviewRun`, independent of whether the
-- reviewer session is making any progress -- a hung session keeps the
-- heartbeat fresh indefinitely. And a run stuck in `pending` is not
-- reconciled at all, since that reconciler only considers `running`.
-- Either way the Issue sits in `reviewing` forever with no control offered.
--
-- This adds the human escape hatch: `p_force`, which cancels whatever run
-- is in flight and queues a fresh one in its place. Cancelling is exactly
-- how every other supersede path releases a claimed run -- the host's
-- control poll sees the run leave `running` within ~10s and aborts it
-- (GEN-414) -- and, like those paths, it consumes no Review Attempt: only
-- `complete_review_attempt` ever does.
drop function if exists public.retry_review_run(text, uuid, timestamptz);

create or replace function public.retry_review_run(
  p_user_id text,
  p_review_cycle_id uuid,
  p_force boolean default false,
  p_now timestamptz default now()
)
returns table (
  review_run_id uuid,
  review_cycle_id uuid,
  cancelled_run_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle review_cycles%rowtype;
  v_live_run_ids uuid[];
  v_completed_attempts integer;
  v_new_run_id uuid;
begin
  select rc.*
    into v_cycle
    from review_cycles rc
    join issue_pull_requests ipr on ipr.id = rc.pull_request_id
    join issues i on i.id = rc.issue_id
    join projects p on p.id = i.project_id
   where rc.id = p_review_cycle_id
     and p.user_id = p_user_id
   for update of rc;

  if not found then
    raise exception 'Review cycle not found' using errcode = 'P0002';
  end if;

  if v_cycle.state <> 'active' then
    raise exception 'Review cycle is not active' using errcode = '23514';
  end if;

  -- The `for update of rc` above is what serializes two concurrent restarts
  -- of the same cycle: the loser blocks, then re-reads and finds the
  -- winner's fresh `pending` run here rather than queueing a second one.
  select coalesce(array_agg(rr.id), '{}'::uuid[])
    into v_live_run_ids
    from review_runs rr
   where rr.review_cycle_id = v_cycle.id
     and rr.status in ('pending', 'running');

  if array_length(v_live_run_ids, 1) is not null and not p_force then
    raise exception 'A review run is already in flight for this cycle'
      using errcode = '23514';
  end if;

  select count(*)
    into v_completed_attempts
    from review_attempts ra
   where ra.review_cycle_id = v_cycle.id;

  -- Checked before cancelling, so a forced restart against an exhausted
  -- budget leaves the in-flight run alone instead of killing the only
  -- attempt that could still conclude the cycle.
  if v_completed_attempts >= 3 then
    raise exception 'Review attempt budget is exhausted for this cycle'
      using errcode = '23514';
  end if;

  update review_runs
     set status = 'cancelled',
         finished_at = p_now,
         updated_at = p_now
   where id = any(v_live_run_ids);

  insert into review_runs (review_cycle_id, status, head_sha)
  values (v_cycle.id, 'pending', v_cycle.head_sha)
  returning id into v_new_run_id;

  perform set_issue_status_from_review(v_cycle.issue_id, 'reviewing', p_now);

  insert into issue_events (issue_id, type, payload)
  values (
    v_cycle.issue_id,
    'review_queued',
    jsonb_build_object(
      'review_cycle_id', v_cycle.id,
      'review_run_id', v_new_run_id,
      'pull_request_id', v_cycle.pull_request_id,
      'head_sha', v_cycle.head_sha,
      'attempt_number', v_completed_attempts + 1,
      'forced', array_length(v_live_run_ids, 1) is not null,
      'cancelled_review_run_ids', to_jsonb(v_live_run_ids)
    )
  );

  return query
    select
      v_new_run_id,
      v_cycle.id,
      coalesce(array_length(v_live_run_ids, 1), 0);
end;
$$;

revoke all on function public.retry_review_run(text, uuid, boolean, timestamptz)
  from public;

grant execute on function public.retry_review_run(text, uuid, boolean, timestamptz)
  to authenticated, service_role;
