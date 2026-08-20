-- Review job claiming (GEN-414, see ADR-0005). GEN-413 built the review
-- lifecycle state machine but left every pending `review_runs` row
-- unclaimed forever -- nothing assigned one to a worker. This migration adds
-- the claim/lease/heartbeat/reconciliation layer on top of the existing
-- `evaluate_review_eligibility` / `complete_review_attempt` /
-- `fail_review_run` engine, without changing any of their semantics.

-- `claimed_by_worker_id` is a permanent audit field, never cleared on
-- release: a `review_runs` row is claimed at most once, and `fail_review_run`
-- always creates a *fresh* row for a retry rather than resetting this one.
-- `status` (running -> terminal) remains the sole liveness signal.
-- `started_at` (added in the original review-lifecycle-tables migration,
-- never previously populated) is reused as the claim timestamp instead of
-- adding a redundant column.
alter table public.review_runs
  add column claimed_by_worker_id uuid references public.workers(id) on delete set null,
  add column heartbeat_at timestamptz;

-- Serves capacity counting, worker-control-state lookup, and
-- reconciliation's join -- all filter on the same (worker, running) shape.
create index review_runs_claimed_by_worker_id_idx
  on public.review_runs(claimed_by_worker_id)
  where status = 'running';

-- Atomically claims the next eligible pending review run for a worker.
-- `for update of rr skip locked` is the same pattern
-- `reconcile_offline_worker_runs` uses for stale workers: a second concurrent
-- caller skips a row already being claimed and either wins a different one
-- or finds none, so two workers can never claim the same review job.
create or replace function public.claim_review_run(
  p_worker_id uuid,
  p_user_id text,
  p_now timestamptz default now()
)
returns table (
  review_run_id uuid,
  review_cycle_id uuid,
  issue_id uuid,
  pull_request_id uuid,
  head_sha text
)
language plpgsql
set search_path = ''
as $$
declare
  v_worker_ok boolean;
  v_run_id uuid;
begin
  select exists (
    select 1
      from public.workers
     where id = p_worker_id
       and user_id = p_user_id
       and banned_at is null
  ) into v_worker_ok;

  if not v_worker_ok then
    return;
  end if;

  select rr.id
    into v_run_id
    from public.review_runs rr
    join public.review_cycles rc
      on rc.id = rr.review_cycle_id
     and rc.state = 'active'
    join public.issue_pull_requests ipr
      on ipr.id = rc.pull_request_id
     and ipr.state in ('open', 'queued')
    join public.issues i on i.id = rc.issue_id
    join public.projects p on p.id = i.project_id
     and p.user_id = p_user_id
   where rr.status = 'pending'
   order by i.priority desc, rr.created_at asc
   for update of rr skip locked
   limit 1;

  if v_run_id is null then
    return;
  end if;

  update public.review_runs
     set status = 'running',
         claimed_by_worker_id = p_worker_id,
         started_at = p_now,
         updated_at = p_now
   where id = v_run_id;

  return query
    select rr.id, rr.review_cycle_id, rc.issue_id, rc.pull_request_id, rr.head_sha
      from public.review_runs rr
      join public.review_cycles rc on rc.id = rr.review_cycle_id
     where rr.id = v_run_id;
end;
$$;

-- Releases every review run a worker currently holds, without consuming a
-- Review Attempt -- reused by both `ban_worker` and `delete_worker`, mirroring
-- `requeue_worker_active_issues`. Goes through `fail_review_run` rather than
-- a bespoke terminal state: that RPC already has exactly the right recovery
-- semantics (no attempt consumed, one automatic retry, then a clean stop).
create or replace function public.requeue_worker_active_review_runs(
  p_worker_id uuid,
  p_now timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run record;
  v_count integer := 0;
begin
  for v_run in
    select id
      from public.review_runs
     where claimed_by_worker_id = p_worker_id
       and status = 'running'
     for update skip locked
  loop
    perform public.fail_review_run(v_run.id, 'Worker banned', p_now);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.ban_worker(
  p_user_id text,
  p_worker_id uuid,
  p_now timestamptz default now()
)
returns public.workers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker public.workers%rowtype;
  v_ignored integer;
begin
  select *
    into v_worker
    from public.workers
   where id = p_worker_id
     and user_id = p_user_id
   for update;

  if not found then
    return null;
  end if;

  if v_worker.banned_at is null then
    update public.workers
       set banned_at = p_now,
           last_seen_at = null,
           updated_at = p_now
     where id = p_worker_id
     returning *
      into v_worker;
  end if;

  v_ignored := public.requeue_worker_active_issues(p_worker_id, p_now);
  v_ignored := public.requeue_worker_active_review_runs(p_worker_id, p_now);

  return v_worker;
end;
$$;

create or replace function public.delete_worker(
  p_user_id text,
  p_worker_id uuid,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker public.workers%rowtype;
  v_ignored integer;
begin
  select *
    into v_worker
    from public.workers
   where id = p_worker_id
     and user_id = p_user_id
   for update;

  if not found then
    return false;
  end if;

  if v_worker.banned_at is null then
    update public.workers
       set banned_at = p_now,
           last_seen_at = null,
           credential_expires_at = greatest(
             p_now,
             v_worker.created_at + interval '1 microsecond'
           ),
           updated_at = p_now
     where id = p_worker_id;
  end if;

  v_ignored := public.requeue_worker_active_issues(p_worker_id, p_now);
  v_ignored := public.requeue_worker_active_review_runs(p_worker_id, p_now);

  delete from public.workers
   where id = p_worker_id
     and user_id = p_user_id;

  return true;
end;
$$;

-- Fails a claimed review run whose worker has gone dark, or whose reviewer
-- session itself stopped heartbeating on an otherwise-live worker. Reuses
-- `fail_review_run` (see `requeue_worker_active_review_runs` above for why),
-- so this also satisfies "retries resume lifecycle state rather than
-- duplicating Review Attempts" for free. Kept as its own function and cron
-- job rather than folded into `reconcile_offline_worker_runs`: the two use
-- structurally different SQL (a set-based CTE there vs. a per-row loop here,
-- because each reconciled row needs `fail_review_run`'s side effects), and
-- merging them would mean one exception aborts both halves of reconciliation
-- for that tick.
create or replace function public.reconcile_offline_review_runs(
  p_now timestamptz default clock_timestamp()
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_run record;
  v_reconciled_count integer := 0;
begin
  for v_run in
    select rr.id
      from public.review_runs rr
      join public.workers w on w.id = rr.claimed_by_worker_id
     where rr.status = 'running'
       and w.banned_at is null
       and (
         coalesce(w.last_seen_at, w.offline_since_at) <= p_now - interval '5 minutes'
         or coalesce(rr.heartbeat_at, rr.started_at) <= p_now - interval '5 minutes'
       )
     for update of rr skip locked
  loop
    perform public.fail_review_run(v_run.id, 'Assigned worker went offline', p_now);
    v_reconciled_count := v_reconciled_count + 1;
  end loop;

  return v_reconciled_count;
end;
$$;

revoke all on function public.claim_review_run(uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.requeue_worker_active_review_runs(uuid, timestamptz)
  from public, authenticated;
revoke all on function public.reconcile_offline_review_runs(timestamptz)
  from public;

grant execute on function public.claim_review_run(uuid, text, timestamptz)
  to service_role;
grant execute on function public.requeue_worker_active_review_runs(uuid, timestamptz)
  to service_role;

-- A stable name makes this migration safe to replay: Supabase Cron upserts an
-- existing job with the same case-sensitive name.
select cron.schedule(
  'reconcile-offline-review-runs',
  '30 seconds',
  $job$select public.reconcile_offline_review_runs();$job$
);
