BEGIN;
SELECT plan(10);

INSERT INTO public.hosts (
  id,
  user_id,
  display_name,
  credential_hash,
  setup_state,
  last_seen_at,
  provider_capabilities
) VALUES (
  '00000000-0000-4000-8000-200000000001',
  'user_capacity',
  'Capacity Host',
  repeat('a', 64),
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
  '10000000-0000-4000-8000-200000000001',
  'user_capacity',
  'Capacity Project',
  'gentic/capacity',
  'CAP'
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
  '20000000-0000-4000-8000-200000000001',
  '10000000-0000-4000-8000-200000000001',
  'Finished task',
  'Body',
  'in-progress',
  1,
  '00000000-0000-4000-8000-200000000001',
  '30000000-0000-4000-8000-200000000001'
), (
  '20000000-0000-4000-8000-200000000002',
  '10000000-0000-4000-8000-200000000001',
  'Reset task',
  'Body',
  'in-progress',
  2,
  '00000000-0000-4000-8000-200000000001',
  '30000000-0000-4000-8000-200000000002'
);

SELECT ok(
  (
    SELECT finished
      FROM public.finish_issue_run_if_no_pending(
        '20000000-0000-4000-8000-200000000001',
        '30000000-0000-4000-8000-200000000001',
        'waiting-for-input',
        '2026-07-30T07:01:00Z'
      )
  ),
  'finishing an issue run succeeds'
);

SELECT is(
  (
    SELECT status
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-200000000001'
  ),
  'waiting-for-input',
  'finished run moves to the requested terminal status'
);

SELECT is(
  (
    SELECT active_run_id
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-200000000001'
  ),
  null,
  'finished run clears its run lease'
);

SELECT is(
  (
    SELECT active_host_id
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-200000000001'
  ),
  null,
  'finished run releases host capacity'
);

SELECT lives_ok(
  $$
    SELECT *
      FROM public.send_issue_user_message(
        '20000000-0000-4000-8000-200000000001',
        'Please continue'
      )
  $$,
  'follow-up message requeues the finished issue'
);

SELECT is(
  (
    SELECT status
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-200000000001'
  ),
  'todo',
  'follow-up issue is ready to claim'
);

SELECT is(
  (
    SELECT active_host_id
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-200000000001'
  ),
  null,
  'follow-up issue does not retain its previous host'
);

SELECT public.reset_issue_run(
  '20000000-0000-4000-8000-200000000002',
  'codex',
  null
);

SELECT is(
  (
    SELECT active_run_id
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-200000000002'
  ),
  null,
  'reset clears the old run lease'
);

SELECT is(
  (
    SELECT active_host_id
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-200000000002'
  ),
  null,
  'reset releases the old host capacity'
);

SELECT throws_ok(
  $$
    INSERT INTO public.issues (
      project_id,
      title,
      body,
      status,
      number,
      active_host_id
    ) VALUES (
      '10000000-0000-4000-8000-200000000001',
      'Invalid orphan',
      'Body',
      'todo',
      3,
      '00000000-0000-4000-8000-200000000001'
    )
  $$,
  '23514',
  null,
  'database rejects host assignments without an active run'
);

SELECT * FROM finish();
ROLLBACK;
