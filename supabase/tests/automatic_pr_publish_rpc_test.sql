BEGIN;
SELECT plan(9);

INSERT INTO public.projects (
  id,
  user_id,
  name,
  repo,
  key
) VALUES (
  '10000000-0000-4000-8000-000000000201',
  'user_gamma',
  'Gamma Project',
  'gentic/gamma',
  'GAM'
), (
  '10000000-0000-4000-8000-000000000202',
  'user_delta',
  'Delta Project',
  'gentic/delta',
  'DEL'
);

INSERT INTO public.issues (
  id,
  project_id,
  title,
  prompt,
  status,
  number,
  create_pr_automatically,
  active_run_id
) VALUES (
  '20000000-0000-4000-8000-000000000201',
  '10000000-0000-4000-8000-000000000201',
  'Publish issue',
  'Prompt',
  'in-progress',
  1,
  true,
  '40000000-0000-4000-8000-000000000201'
);

SELECT lives_ok(
  $$
    SELECT * FROM public.request_automatic_pr_publish(
      '20000000-0000-4000-8000-000000000201',
      '40000000-0000-4000-8000-000000000201',
      'Please open a pull request.'
    )
  $$,
  'the first request for a run succeeds'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.issue_automatic_pr_requests
     WHERE issue_id = '20000000-0000-4000-8000-000000000201'
  ),
  1,
  'exactly one request row is created'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.messages
     WHERE issue_id = '20000000-0000-4000-8000-000000000201'
       AND generated_action = 'create_pr'
  ),
  1,
  'exactly one create_pr message is created'
);

SELECT is(
  (
    SELECT m.role
      FROM public.messages m
      JOIN public.issue_automatic_pr_requests r
        ON r.requested_by_message_id = m.id
     WHERE r.issue_id = '20000000-0000-4000-8000-000000000201'
  ),
  'user',
  'the created message is a visible user-role message'
);

SELECT is(
  (
    SELECT m.author_type
      FROM public.messages m
      JOIN public.issue_automatic_pr_requests r
        ON r.requested_by_message_id = m.id
     WHERE r.issue_id = '20000000-0000-4000-8000-000000000201'
  ),
  'gentic',
  'the created message is Gentic-authored'
);

-- A duplicate/retried call for the same run must not create a second
-- request or message (idempotent under a worker restart replaying the
-- same run id).
SELECT lives_ok(
  $$
    SELECT * FROM public.request_automatic_pr_publish(
      '20000000-0000-4000-8000-000000000201',
      '40000000-0000-4000-8000-000000000201',
      'Please open a pull request.'
    )
  $$,
  'a duplicate request for the same run does not raise'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.issue_automatic_pr_requests
     WHERE issue_id = '20000000-0000-4000-8000-000000000201'
  ),
  1,
  'a duplicate request for the same run does not create a second row'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.messages
     WHERE issue_id = '20000000-0000-4000-8000-000000000201'
       AND generated_action = 'create_pr'
  ),
  1,
  'a duplicate request for the same run does not create a second message'
);

-- A stale/superseded run id (no longer the issue's active run) is rejected
-- outright, matching the existing active-run trigger's contract.
SELECT throws_ok(
  $$
    SELECT * FROM public.request_automatic_pr_publish(
      '20000000-0000-4000-8000-000000000201',
      '40000000-0000-4000-8000-000000000202',
      'Please open a pull request.'
    )
  $$,
  '23514',
  'a stale run id is rejected'
);

SELECT * FROM finish();
ROLLBACK;
