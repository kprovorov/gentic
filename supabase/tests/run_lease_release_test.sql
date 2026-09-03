BEGIN;
SELECT plan(11);

INSERT INTO public.hosts (
  id,
  user_id,
  display_name,
  credential_hash,
  setup_state,
  last_seen_at,
  provider_capabilities
) VALUES (
  '00000000-0000-4000-8000-300000000001',
  'user_lease',
  'Lease Host',
  repeat('b', 64),
  'ready',
  '2026-07-30T07:00:00Z',
  '{"providers":{}}'::jsonb
);

INSERT INTO public.projects (
  id,
  user_id,
  name,
  repo,
  key
) VALUES (
  '10000000-0000-4000-8000-300000000001',
  'user_lease',
  'Lease Project',
  'gentic/lease',
  'LSE'
);

INSERT INTO public.issues (
  id,
  project_id,
  title,
  body,
  status,
  number,
  active_host_id,
  active_run_id
) VALUES (
  '20000000-0000-4000-8000-300000000001',
  '10000000-0000-4000-8000-300000000001',
  'Failing task',
  'Body',
  'in-progress',
  1,
  '00000000-0000-4000-8000-300000000001',
  '30000000-0000-4000-8000-300000000001'
), (
  '20000000-0000-4000-8000-300000000002',
  '10000000-0000-4000-8000-300000000001',
  'Usage limited task',
  'Body',
  'in-progress',
  2,
  '00000000-0000-4000-8000-300000000001',
  '30000000-0000-4000-8000-300000000002'
), (
  '20000000-0000-4000-8000-300000000003',
  '10000000-0000-4000-8000-300000000001',
  'Live task',
  'Body',
  'queued',
  3,
  '00000000-0000-4000-8000-300000000001',
  '30000000-0000-4000-8000-300000000003'
);

-- A host reporting its own failure goes through a plain status update.
UPDATE public.issues
   SET status = 'run-failed',
       run_error = 'agent crashed',
       run_finished_at = '2026-07-30T07:01:00Z'
 WHERE id = '20000000-0000-4000-8000-300000000001';

SELECT is(
  (
    SELECT active_run_id
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-300000000001'
  ),
  null,
  'a failed run clears its run lease'
);

SELECT is(
  (
    SELECT active_host_id
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-300000000001'
  ),
  null,
  'a failed run releases host capacity'
);

SELECT is(
  (
    SELECT run_error
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-300000000001'
  ),
  'agent crashed',
  'releasing the lease keeps the reported failure reason'
);

-- Held runs are re-claimed as a fresh run once the usage limit resets, and
-- claiming requires `active_run_id is null`.
UPDATE public.issues
   SET status = 'held',
       usage_limit_reset_at = '2026-07-30T08:00:00Z'
 WHERE id = '20000000-0000-4000-8000-300000000002';

SELECT is(
  (
    SELECT active_run_id
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-300000000002'
  ),
  null,
  'a usage-limit hold clears its run lease so it can be re-claimed'
);

SELECT is(
  (
    SELECT active_host_id
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-300000000002'
  ),
  null,
  'a usage-limit hold releases host capacity'
);

SELECT is(
  (
    SELECT usage_limit_reset_at
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-300000000002'
  ),
  '2026-07-30T08:00:00Z'::timestamptz,
  'releasing the lease keeps the usage limit reset time'
);

-- Live runs keep their lease, otherwise the host loses the issue mid-run.
SELECT is(
  (
    SELECT active_run_id
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-300000000003'
  ),
  '30000000-0000-4000-8000-300000000003'::uuid,
  'a queued run keeps its lease'
);

UPDATE public.issues
   SET status = 'in-progress'
 WHERE id = '20000000-0000-4000-8000-300000000003';

SELECT is(
  (
    SELECT active_host_id
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-300000000003'
  ),
  '00000000-0000-4000-8000-300000000001'::uuid,
  'starting a queued run keeps the host attached'
);

-- Unrelated updates during a live run must not disturb the lease.
UPDATE public.issues
   SET session_id = 'session-123'
 WHERE id = '20000000-0000-4000-8000-300000000003';

SELECT is(
  (
    SELECT active_run_id
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-300000000003'
  ),
  '30000000-0000-4000-8000-300000000003'::uuid,
  'a mid-run field update keeps the lease'
);

-- Cancelling from the issue status dropdown is how a user stops a live run:
-- dropping the lease is what the host polls for to abort.
UPDATE public.issues
   SET status = 'cancelled'
 WHERE id = '20000000-0000-4000-8000-300000000003';

SELECT is(
  (
    SELECT active_host_id
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-300000000003'
  ),
  null,
  'cancelling a live run releases its host'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.issues
     WHERE active_host_id = '00000000-0000-4000-8000-300000000001'
       AND active_run_id IS NOT NULL
  ),
  0,
  'no dead run counts against the host capacity'
);

SELECT * FROM finish();
ROLLBACK;
