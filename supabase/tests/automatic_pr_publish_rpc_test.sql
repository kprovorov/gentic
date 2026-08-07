BEGIN;
SELECT plan(16);

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
  body,
  status,
  number,
  create_pr_automatically,
  has_unpublished_agent_changes,
  active_run_id
) VALUES (
  '20000000-0000-4000-8000-000000000201',
  '10000000-0000-4000-8000-000000000201',
  'Publish issue',
  'Body',
  'in-progress',
  1,
  true,
  true,
  '40000000-0000-4000-8000-000000000201'
), (
  -- Already has a PR: ineligible for an automatic request.
  '20000000-0000-4000-8000-000000000202',
  '10000000-0000-4000-8000-000000000201',
  'Already published issue',
  'Body',
  'in-progress',
  2,
  true,
  true,
  '40000000-0000-4000-8000-000000000203'
), (
  -- No unpublished changes: ineligible for an automatic request.
  '20000000-0000-4000-8000-000000000203',
  '10000000-0000-4000-8000-000000000201',
  'Clean issue',
  'Body',
  'in-progress',
  3,
  true,
  false,
  '40000000-0000-4000-8000-000000000204'
), (
  -- Not opted in to automatic PR creation: ineligible for a request.
  '20000000-0000-4000-8000-000000000204',
  '10000000-0000-4000-8000-000000000201',
  'Opted-out issue',
  'Body',
  'in-progress',
  4,
  false,
  true,
  '40000000-0000-4000-8000-000000000205'
), (
  -- The webhook association is authoritative even when the legacy field is null.
  '20000000-0000-4000-8000-000000000205',
  '10000000-0000-4000-8000-000000000201',
  'Webhook-associated issue',
  'Body',
  'in-progress',
  5,
  true,
  true,
  '40000000-0000-4000-8000-000000000206'
);

INSERT INTO public.issue_pull_requests (issue_id, url)
VALUES (
  '20000000-0000-4000-8000-000000000202',
  'https://github.com/gentic/gamma/pull/1'
);

INSERT INTO public.issue_pull_requests (issue_id, url, state)
VALUES (
  '20000000-0000-4000-8000-000000000205',
  'https://github.com/gentic/gamma/pull/5',
  'open'
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
-- same run id), and must report the winning caller's own ids.
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
    SELECT created FROM public.request_automatic_pr_publish(
      '20000000-0000-4000-8000-000000000201',
      '40000000-0000-4000-8000-000000000201',
      'Please open a pull request.'
    )
  ),
  false,
  'a duplicate request reports created = false'
);

SELECT is(
  (
    SELECT message_id FROM public.request_automatic_pr_publish(
      '20000000-0000-4000-8000-000000000201',
      '40000000-0000-4000-8000-000000000201',
      'Please open a pull request.'
    )
  ),
  (
    SELECT requested_by_message_id
      FROM public.issue_automatic_pr_requests
     WHERE issue_id = '20000000-0000-4000-8000-000000000201'
  ),
  'a duplicate request returns the winning message id'
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

INSERT INTO public.issue_pull_requests (issue_id, url, state)
VALUES (
  '20000000-0000-4000-8000-000000000201',
  'https://github.com/gentic/gamma/pull/6',
  'open'
);

SELECT is(
  (
    SELECT created FROM public.request_automatic_pr_publish(
      '20000000-0000-4000-8000-000000000201',
      '40000000-0000-4000-8000-000000000201',
      'Please open a pull request.'
    )
  ),
  false,
  'a retry returns the existing request after a webhook association arrives'
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
  null,
  'a stale run id is rejected'
);

-- Eligibility (create_pr_automatically, no existing PR, unpublished changes
-- remain) is re-checked atomically inside the insert itself, not just as a
-- pre-check in application code, so a request can't be created for an issue
-- that no longer qualifies.
SELECT throws_ok(
  $$
    SELECT * FROM public.request_automatic_pr_publish(
      '20000000-0000-4000-8000-000000000202',
      '40000000-0000-4000-8000-000000000203',
      'Please open a pull request.'
    )
  $$,
  '23514',
  null,
  'a request for an issue that already has a pull request is rejected'
);

SELECT throws_ok(
  $$
    SELECT * FROM public.request_automatic_pr_publish(
      '20000000-0000-4000-8000-000000000203',
      '40000000-0000-4000-8000-000000000204',
      'Please open a pull request.'
    )
  $$,
  '23514',
  null,
  'a request for an issue with no unpublished changes is rejected'
);

SELECT throws_ok(
  $$
    SELECT * FROM public.request_automatic_pr_publish(
      '20000000-0000-4000-8000-000000000204',
      '40000000-0000-4000-8000-000000000205',
      'Please open a pull request.'
    )
  $$,
  '23514',
  null,
  'a request for an issue not opted into automatic PR creation is rejected'
);

SELECT throws_ok(
  $$
    SELECT * FROM public.request_automatic_pr_publish(
      '20000000-0000-4000-8000-000000000205',
      '40000000-0000-4000-8000-000000000206',
      'Please open a pull request.'
    )
  $$,
  '23514',
  null,
  'a webhook association suppresses a duplicate automatic publishing request'
);

SELECT * FROM finish();
ROLLBACK;
