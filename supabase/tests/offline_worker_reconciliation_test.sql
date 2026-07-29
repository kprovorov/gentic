BEGIN;
SELECT plan(30);

SELECT has_extension('pg_cron', 'pg_cron is enabled for reliable scheduling');

SELECT is(
  (
    SELECT schedule
      FROM cron.job
     WHERE jobname = 'reconcile-offline-worker-runs'
  ),
  '30 seconds',
  'offline-worker reconciliation runs every 30 seconds'
);

SELECT is(
  (
    SELECT command
      FROM cron.job
     WHERE jobname = 'reconcile-offline-worker-runs'
  ),
  'select public.reconcile_offline_worker_runs();',
  'cron invokes the atomic database reconciliation function'
);

INSERT INTO public.projects (id, user_id, name, repo, key)
VALUES (
  '10000000-0000-4000-8000-000000000041',
  'offline_test_user',
  'Offline worker project',
  'gentic/offline-worker',
  'OFF'
);

INSERT INTO public.workers (
  id,
  user_id,
  display_name,
  credential_hash,
  setup_state,
  last_seen_at,
  offline_since_at,
  updated_at
) VALUES
  (
    '40000000-0000-4000-8000-000000000041',
    'offline_test_user',
    'Boundary Worker',
    repeat('1', 64),
    'ready',
    '2026-07-29T11:55:00Z',
    null,
    '2026-07-29T11:55:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000042',
    'offline_test_user',
    'Fresh Worker',
    repeat('2', 64),
    'ready',
    '2026-07-29T11:58:30Z',
    null,
    '2026-07-29T11:58:30Z'
  ),
  (
    '40000000-0000-4000-8000-000000000043',
    'offline_test_user',
    'Graceful Offline Worker',
    repeat('3', 64),
    'ready',
    null,
    '2026-07-29T11:55:00Z',
    '2026-07-29T11:55:00Z'
  );

INSERT INTO public.issues (
  id,
  project_id,
  title,
  prompt,
  status,
  number,
  active_run_id,
  active_worker_id,
  run_started_at
) VALUES
  (
    '50000000-0000-4000-8000-000000000041',
    '10000000-0000-4000-8000-000000000041',
    'Exactly five minutes stale',
    'Boundary prompt',
    'in-progress',
    1,
    '60000000-0000-4000-8000-000000000041',
    '40000000-0000-4000-8000-000000000041',
    '2026-07-29T11:50:00Z'
  ),
  (
    '50000000-0000-4000-8000-000000000042',
    '10000000-0000-4000-8000-000000000041',
    'Ninety seconds stale',
    'Display boundary prompt',
    'in-progress',
    2,
    '60000000-0000-4000-8000-000000000042',
    '40000000-0000-4000-8000-000000000042',
    '2026-07-29T11:50:00Z'
  ),
  (
    '50000000-0000-4000-8000-000000000043',
    '10000000-0000-4000-8000-000000000041',
    'Null heartbeat uses offline transition time',
    'Graceful offline prompt',
    'queued',
    3,
    '60000000-0000-4000-8000-000000000043',
    '40000000-0000-4000-8000-000000000043',
    '2026-07-29T11:50:00Z'
  ),
  (
    '50000000-0000-4000-8000-000000000044',
    '10000000-0000-4000-8000-000000000041',
    'Second task on the stale worker',
    'Concurrent assignment prompt',
    'queued',
    4,
    '60000000-0000-4000-8000-000000000044',
    '40000000-0000-4000-8000-000000000041',
    '2026-07-29T11:50:00Z'
  );

SELECT is(
  public.reconcile_offline_worker_runs('2026-07-29T11:59:59.999Z'),
  0,
  'reconciliation does not fail a run before five minutes'
);

SELECT is(
  (
    SELECT status
      FROM public.issues
     WHERE id = '50000000-0000-4000-8000-000000000041'
  ),
  'in-progress',
  'the assigned task remains active before the five-minute boundary'
);

SELECT is(
  (
    SELECT status
      FROM public.issues
     WHERE id = '50000000-0000-4000-8000-000000000042'
  ),
  'in-progress',
  'the 90-second display boundary does not change task state'
);

SELECT is(
  public.reconcile_offline_worker_runs('2026-07-29T12:00:00Z'),
  3,
  'reconciliation fails assignments at exactly five minutes'
);

SELECT is(
  (
    SELECT status
      FROM public.issues
     WHERE id = '50000000-0000-4000-8000-000000000041'
  ),
  'run-failed',
  'a stale worker active task becomes run-failed'
);

SELECT is(
  (
    SELECT status
      FROM public.issues
     WHERE id = '50000000-0000-4000-8000-000000000044'
  ),
  'run-failed',
  'one invocation fails every active task assigned to the stale worker'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.issue_events
     WHERE issue_id IN (
       '50000000-0000-4000-8000-000000000041',
       '50000000-0000-4000-8000-000000000044'
     )
       AND type = 'run_failed'
  ),
  2,
  'one invocation records one event for each stale worker task'
);

SELECT is(
  (
    SELECT active_run_id
      FROM public.issues
     WHERE id = '50000000-0000-4000-8000-000000000041'
  ),
  null,
  'the stale active run id is invalidated'
);

SELECT is(
  (
    SELECT active_worker_id
      FROM public.issues
     WHERE id = '50000000-0000-4000-8000-000000000041'
  ),
  null,
  'the stale worker lease is cleared'
);

SELECT is(
  (
    SELECT run_error
      FROM public.issues
     WHERE id = '50000000-0000-4000-8000-000000000041'
  ),
  'Assigned worker went offline',
  'the failed task has a human-readable run error'
);

SELECT is(
  (
    SELECT payload -> 'reason' ->> 'code'
      FROM public.issue_events
     WHERE issue_id = '50000000-0000-4000-8000-000000000041'
       AND type = 'run_failed'
  ),
  'assigned_worker_offline',
  'the failure event records a structured offline reason'
);

SELECT is(
  (
    SELECT payload -> 'reason' ->> 'worker_id'
      FROM public.issue_events
     WHERE issue_id = '50000000-0000-4000-8000-000000000041'
       AND type = 'run_failed'
  ),
  '40000000-0000-4000-8000-000000000041',
  'the structured reason preserves the stale worker id'
);

SELECT is(
  (
    SELECT payload -> 'reason' ->> 'active_run_id'
      FROM public.issue_events
     WHERE issue_id = '50000000-0000-4000-8000-000000000041'
       AND type = 'run_failed'
  ),
  '60000000-0000-4000-8000-000000000041',
  'the structured reason preserves the invalidated run id'
);

SELECT is(
  (
    SELECT run_finished_at
      FROM public.issues
     WHERE id = '50000000-0000-4000-8000-000000000041'
  ),
  '2026-07-29T12:00:00+00'::timestamptz,
  'the injected reconciliation clock sets the failure timestamp'
);

SELECT is(
  (
    SELECT last_seen_at
      FROM public.workers
     WHERE id = '40000000-0000-4000-8000-000000000041'
  ),
  '2026-07-29T11:55:00+00'::timestamptz,
  'reconciliation leaves the stale worker record offline'
);

SELECT is(
  (
    SELECT status
      FROM public.issues
     WHERE id = '50000000-0000-4000-8000-000000000042'
  ),
  'in-progress',
  'a task newer than five minutes remains assigned'
);

SELECT is(
  public.reconcile_offline_worker_runs('2026-07-29T12:00:00Z'),
  0,
  'a repeated reconciliation is idempotent'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.issue_events
     WHERE issue_id = '50000000-0000-4000-8000-000000000041'
       AND type = 'run_failed'
  ),
  1,
  'idempotent reconciliation records one failure event'
);

UPDATE public.workers
   SET last_seen_at = '2026-07-29T12:00:01Z',
       updated_at = '2026-07-29T12:00:01Z'
 WHERE id = '40000000-0000-4000-8000-000000000041';

SELECT is(
  (
    SELECT status
      FROM public.issues
     WHERE id = '50000000-0000-4000-8000-000000000041'
  ),
  'run-failed',
  'a late worker heartbeat does not resume the failed task'
);

SELECT is(
  (
    SELECT active_run_id
      FROM public.issues
     WHERE id = '50000000-0000-4000-8000-000000000041'
  ),
  null,
  'a late worker heartbeat does not restore the old run id'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.issues
     WHERE active_worker_id = '40000000-0000-4000-8000-000000000041'
       AND active_run_id = '60000000-0000-4000-8000-000000000041'
  ),
  0,
  'worker control cannot return the invalidated local session'
);

SELECT lives_ok(
  $$
    SELECT public.reset_issue_run(
      '50000000-0000-4000-8000-000000000041',
      'codex',
      null
    )
  $$,
  'manual retry remains available after offline reconciliation'
);

SELECT is(
  (
    SELECT status
      FROM public.issues
     WHERE id = '50000000-0000-4000-8000-000000000041'
  ),
  'todo',
  'manual retry explicitly returns the failed task to todo'
);

SELECT is(
  (
    SELECT run_error
      FROM public.issues
     WHERE id = '50000000-0000-4000-8000-000000000041'
  ),
  null,
  'manual retry clears the offline failure text'
);

SELECT is(
  (
    SELECT active_worker_id
      FROM public.issues
     WHERE id = '50000000-0000-4000-8000-000000000041'
  ),
  null,
  'manual retry leaves the failed worker lease cleared'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.messages
     WHERE issue_id = '50000000-0000-4000-8000-000000000041'
       AND role = 'user'
       AND consumed_by_run_id is null
  ),
  1,
  'manual retry creates a pending prompt for a fresh run'
);

SELECT is(
  (
    SELECT last_seen_at
      FROM public.workers
     WHERE id = '40000000-0000-4000-8000-000000000043'
  ),
  null,
  'the scheduler does not mutate a worker explicitly marked offline'
);

SELECT * FROM finish();
ROLLBACK;
