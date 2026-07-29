# Supabase operations

## Offline worker reconciliation

The `reconcile-offline-worker-runs` Supabase Cron job runs every 30 seconds.
It calls `public.reconcile_offline_worker_runs()` inside Postgres, so selecting
stale assignments, failing their runs, clearing leases, and recording failure
events happen in one database transaction without a network dependency.

The job treats a worker assignment as stale after five minutes without a
heartbeat. Worker presence becomes offline in the application after 90 seconds,
but that display boundary does not mutate tasks. Reconciliation changes active
tasks to `run-failed`, clears `active_run_id` and `active_worker_id`, and writes
a `run_failed` issue event whose `reason.code` is
`assigned_worker_offline`. It never requeues a failed task. A user must retry
the task manually to create a fresh run id.

Reconciliation does not update or delete the worker. Its stale `last_seen_at`
keeps an unexpectedly disconnected worker offline. An explicit offline
transition records `offline_since_at` before clearing `last_seen_at`. The next
heartbeat clears `offline_since_at`. A late heartbeat only restores worker
presence. It cannot restore the cleared assignment or invalidated run id, so
worker control tells the reconnecting process to abort any matching local
session.

The function claims stale workers with `FOR UPDATE ... SKIP LOCKED`, then
reconciles every active assignment for each claimed worker. Concurrent Cron
invocations divide workers without producing duplicate state changes or events.
The optional `p_now` argument exists for clock-controlled database tests;
production calls must omit it.

### Deployment and monitoring

The migration enables `pg_cron` and schedules the job with its stable,
case-sensitive name. Supabase Cron replaces a job when `cron.schedule` receives
the same name, which makes migration replay safe.

Inspect the installed job and recent runs with:

```sql
select jobid, jobname, schedule, command, active
from cron.job
where jobname = 'reconcile-offline-worker-runs';

select status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (
  select jobid
  from cron.job
  where jobname = 'reconcile-offline-worker-runs'
)
order by start_time desc
limit 20;
```

Cron run history is not removed automatically. Include
`cron.job_run_details` retention in normal database maintenance.
