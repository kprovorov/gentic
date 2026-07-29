create extension if not exists pg_cron;

alter table public.workers
  add column offline_since_at timestamptz;

-- Fail active runs whose assigned worker has stopped heartbeating. The
-- timestamp parameter makes the five-minute boundary deterministic in tests;
-- scheduled calls use the database clock.
--
-- `for update ... skip locked` claims each stale worker once. A concurrent
-- heartbeat either wins first and makes the worker fresh, or waits until all of
-- that worker's stale assignments have been invalidated. Concurrent reconcilers
-- skip each other's workers, so each run produces at most one event.
create or replace function public.reconcile_offline_worker_runs(
  p_now timestamptz default clock_timestamp()
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_reconciled_count integer;
begin
  with stale_workers as materialized (
    select
      workers.id,
      workers.last_seen_at,
      workers.offline_since_at
    from public.workers
    where workers.banned_at is null
      and coalesce(workers.last_seen_at, workers.offline_since_at)
        <= p_now - interval '5 minutes'
      and exists (
        select 1
        from public.issues
        where issues.active_worker_id = workers.id
          and issues.active_run_id is not null
          and issues.status in (
            'queued',
            'held',
            'in-progress',
            'waiting-for-input'
          )
      )
    for update of workers skip locked
  ),
  stale_assignments as materialized (
    select
      issues.id as issue_id,
      issues.active_run_id,
      issues.active_worker_id,
      stale_workers.last_seen_at,
      stale_workers.offline_since_at
    from public.issues
    join stale_workers
      on stale_workers.id = issues.active_worker_id
    where issues.active_run_id is not null
      and issues.status in (
        'queued',
        'held',
        'in-progress',
        'waiting-for-input'
      )
  ),
  failed as (
    update public.issues
    set
      status = 'run-failed',
      active_run_id = null,
      active_worker_id = null,
      run_error = 'Assigned worker went offline',
      run_finished_at = p_now,
      usage_limit_reset_at = null,
      updated_at = p_now
    from stale_assignments
    where issues.id = stale_assignments.issue_id
      and issues.active_run_id = stale_assignments.active_run_id
      and issues.active_worker_id = stale_assignments.active_worker_id
    returning
      issues.id,
      stale_assignments.active_run_id,
      stale_assignments.active_worker_id,
      stale_assignments.last_seen_at,
      stale_assignments.offline_since_at
  ),
  recorded as (
    insert into public.issue_events(issue_id, type, payload, created_at)
    select
      failed.id,
      'run_failed',
      jsonb_build_object(
        'reason', jsonb_build_object(
          'code', 'assigned_worker_offline',
          'worker_id', failed.active_worker_id,
          'active_run_id', failed.active_run_id,
          'last_seen_at', failed.last_seen_at,
          'offline_since_at', failed.offline_since_at
        ),
        'failed_at', p_now
      ),
      p_now
    from failed
    returning 1
  )
  select count(*)::integer
    into v_reconciled_count
    from recorded;

  return v_reconciled_count;
end;
$$;

revoke all on function public.reconcile_offline_worker_runs(timestamptz)
  from public;

-- A stable name makes this migration safe to replay: Supabase Cron upserts an
-- existing job with the same case-sensitive name.
select cron.schedule(
  'reconcile-offline-worker-runs',
  '30 seconds',
  $job$select public.reconcile_offline_worker_runs();$job$
);
