BEGIN;
SELECT plan(13);

INSERT INTO public.projects (id, user_id, name, repo, key) VALUES
  ('10000000-0000-4000-8000-600000000001', 'user_webhook', 'Webhook Project', 'acme/base', 'GEN');

INSERT INTO public.issues (
  id,
  project_id,
  title,
  status,
  number,
  active_run_id
) VALUES
  (
    '20000000-0000-4000-8000-600000000001',
    '10000000-0000-4000-8000-600000000001',
    'Inactive issue',
    'todo',
    1,
    NULL
  ),
  (
    '20000000-0000-4000-8000-600000000002',
    '10000000-0000-4000-8000-600000000001',
    'Different issue',
    'todo',
    2,
    NULL
  ),
  (
    '20000000-0000-4000-8000-600000000003',
    '10000000-0000-4000-8000-600000000001',
    'Draft PR issue',
    'todo',
    3,
    NULL
  ),
  (
    '20000000-0000-4000-8000-600000000004',
    '10000000-0000-4000-8000-600000000001',
    'Active issue',
    'in-progress',
    4,
    '30000000-0000-4000-8000-600000000004'
  );

CREATE TEMP TABLE first_association AS
SELECT *
  FROM public.associate_pull_request_from_webhook(
    '20000000-0000-4000-8000-600000000001',
    'https://github.com/acme/base/pull/1',
    'open',
    true,
    'head-1'
  );

SELECT is(
  (SELECT association_created FROM first_association),
  true,
  'the first delivery creates an association'
);

SELECT is(
  (SELECT associated_issue_id FROM first_association),
  '20000000-0000-4000-8000-600000000001'::uuid,
  'the first delivery returns the associated issue'
);

SELECT is(
  (SELECT issue_status_changed FROM first_association),
  true,
  'a reviewable PR advances an inactive issue'
);

SELECT is(
  (SELECT status FROM public.issues WHERE number = 1),
  'ready-for-review',
  'the inactive issue is ready for review'
);

SELECT is(
  (SELECT count(*)::integer FROM public.issue_events WHERE type = 'pr_associated'),
  1,
  'the new association emits one pr_associated event'
);

SELECT is(
  (SELECT count(*)::integer FROM public.issue_events WHERE type = 'status_changed'),
  1,
  'the status transition emits one status_changed event'
);

CREATE TEMP TABLE repeated_association AS
SELECT *
  FROM public.associate_pull_request_from_webhook(
    '20000000-0000-4000-8000-600000000002',
    'https://github.com/acme/base/pull/1',
    'open',
    true,
    'head-1'
  );

SELECT is(
  (SELECT association_created FROM repeated_association),
  false,
  'a repeated delivery does not create another association'
);

SELECT is(
  (SELECT associated_issue_id FROM repeated_association),
  '20000000-0000-4000-8000-600000000001'::uuid,
  'a later branch match cannot reassign the sticky PR URL'
);

SELECT is(
  (SELECT count(*)::integer FROM public.issue_pull_requests),
  1,
  'repeated delivery creates no duplicate row'
);

SELECT is(
  (SELECT count(*)::integer FROM public.issue_events WHERE type = 'pr_associated'),
  1,
  'repeated delivery creates no duplicate timeline event'
);

SELECT public.associate_pull_request_from_webhook(
  '20000000-0000-4000-8000-600000000003',
  'https://github.com/acme/base/pull/3',
  'draft',
  false,
  'head-3'
);

SELECT is(
  (SELECT status FROM public.issues WHERE number = 3),
  'todo',
  'a draft PR does not affect issue status'
);

SELECT public.associate_pull_request_from_webhook(
  '20000000-0000-4000-8000-600000000004',
  'https://github.com/acme/base/pull/4',
  'open',
  true,
  'head-4'
);

SELECT is(
  (SELECT status FROM public.issues WHERE number = 4),
  'in-progress',
  'an active run retains its live status'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.issue_events
     WHERE type = 'pr_opened'
  ),
  0,
  'the webhook path does not emit the legacy pr_opened event'
);

ROLLBACK;
