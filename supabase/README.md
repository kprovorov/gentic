# Supabase operations

## Offline host reconciliation

The `reconcile-offline-host-runs` Supabase Cron job runs every 30 seconds.
It calls `public.reconcile_offline_host_runs()` inside Postgres, so selecting
stale assignments, failing their runs, clearing leases, and recording failure
events happen in one database transaction without a network dependency.

The job treats a host assignment as stale after five minutes without a
heartbeat. Host presence becomes offline in the application after 90 seconds,
but that display boundary does not mutate tasks. Reconciliation changes active
tasks to `run-failed`, clears `active_run_id` and `active_host_id`, and writes
a `run_failed` issue event whose `reason.code` is
`assigned_host_offline`. It never requeues a failed task. A user must retry
the task manually to create a fresh run id.

Reconciliation does not update or delete the host. Its stale `last_seen_at`
keeps an unexpectedly disconnected host offline. An explicit offline
transition records `offline_since_at` before clearing `last_seen_at`. The next
heartbeat clears `offline_since_at`. A late heartbeat only restores host
presence. It cannot restore the cleared assignment or invalidated run id, so
host control tells the reconnecting process to abort any matching local
session.

The function claims stale hosts with `FOR UPDATE ... SKIP LOCKED`, then
reconciles every active assignment for each claimed host. Concurrent Cron
invocations divide hosts without producing duplicate state changes or events.
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
where jobname = 'reconcile-offline-host-runs';

select status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (
  select jobid
  from cron.job
  where jobname = 'reconcile-offline-host-runs'
)
order by start_time desc
limit 20;
```

Cron run history is not removed automatically. Include
`cron.job_run_details` retention in normal database maintenance.
