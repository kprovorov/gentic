BEGIN;
SELECT plan(14);

INSERT INTO public.projects (id, user_id, name, repo, key) VALUES
  ('12000000-0000-4000-8000-700000000001', 'user_aggregate', 'Aggregate Project', 'acme/aggregate', 'AGG');

INSERT INTO public.issues (id, project_id, title, status, number) VALUES
  ('22000000-0000-4000-8000-700000000001', '12000000-0000-4000-8000-700000000001', 'Precedence', 'ready-for-review', 1),
  ('22000000-0000-4000-8000-700000000002', '12000000-0000-4000-8000-700000000001', 'Draft exclusion', 'deploying', 2),
  ('22000000-0000-4000-8000-700000000003', '12000000-0000-4000-8000-700000000001', 'Reopen merged', 'merged', 3),
  ('22000000-0000-4000-8000-700000000004', '12000000-0000-4000-8000-700000000001', 'Reopen deploying', 'deploying', 4),
  ('22000000-0000-4000-8000-700000000005', '12000000-0000-4000-8000-700000000001', 'Reopen failed deployment', 'deploy-failed', 5),
  ('22000000-0000-4000-8000-700000000006', '12000000-0000-4000-8000-700000000001', 'Reopen validating', 'validating', 6),
  ('22000000-0000-4000-8000-700000000007', '12000000-0000-4000-8000-700000000001', 'Protect completed', 'completed', 7),
  ('22000000-0000-4000-8000-700000000008', '12000000-0000-4000-8000-700000000001', 'Protect cancelled', 'cancelled', 8),
  ('22000000-0000-4000-8000-700000000009', '12000000-0000-4000-8000-700000000001', 'Delivery order', 'ready-for-review', 9);

INSERT INTO public.issue_pull_requests (
  issue_id, url, state, head_sha, ci_state, review_decision
) VALUES
  ('22000000-0000-4000-8000-700000000001', 'https://github.com/acme/aggregate/pull/1', 'open', 'head-1', 'success', 'changes_requested'),
  ('22000000-0000-4000-8000-700000000001', 'https://github.com/acme/aggregate/pull/2', 'open', 'head-2', 'failure', 'approved'),
  ('22000000-0000-4000-8000-700000000001', 'https://github.com/acme/aggregate/pull/3', 'open', 'head-3', 'pending', 'approved'),
  ('22000000-0000-4000-8000-700000000001', 'https://github.com/acme/aggregate/pull/4', 'open', 'head-4', 'success', 'approved'),
  ('22000000-0000-4000-8000-700000000001', 'https://github.com/acme/aggregate/pull/5', 'draft', 'head-5', 'failure', 'changes_requested'),
  ('22000000-0000-4000-8000-700000000002', 'https://github.com/acme/aggregate/pull/6', 'draft', 'head-6', 'failure', 'changes_requested'),
  ('22000000-0000-4000-8000-700000000004', 'https://github.com/acme/aggregate/pull/8', 'open', 'head-8', 'failure', 'approved'),
  ('22000000-0000-4000-8000-700000000005', 'https://github.com/acme/aggregate/pull/9', 'open', 'head-9', 'pending', 'approved'),
  ('22000000-0000-4000-8000-700000000006', 'https://github.com/acme/aggregate/pull/10', 'open', 'head-10', 'success', 'approved'),
  ('22000000-0000-4000-8000-700000000007', 'https://github.com/acme/aggregate/pull/11', 'open', 'head-11', 'failure', 'changes_requested'),
  ('22000000-0000-4000-8000-700000000008', 'https://github.com/acme/aggregate/pull/12', 'open', 'head-12', 'failure', 'changes_requested'),
  ('22000000-0000-4000-8000-700000000009', 'https://github.com/acme/aggregate/pull/13', 'open', 'head-13', 'unknown', 'unknown'),
  ('22000000-0000-4000-8000-700000000009', 'https://github.com/acme/aggregate/pull/14', 'open', 'head-14', 'unknown', 'unknown');

SELECT public.recompute_issue_status_from_pull_requests('22000000-0000-4000-8000-700000000001');
SELECT is(
  (SELECT status FROM public.issues WHERE number = 1),
  'changes-requested',
  'changes requested has the strongest unresolved PR precedence'
);

SELECT public.apply_pull_request_delivery_state('https://github.com/acme/aggregate/pull/1', p_state => 'closed');
SELECT is(
  (SELECT status FROM public.issues WHERE number = 1),
  'tests-failed',
  'failed tests surface after all active change requests resolve'
);

SELECT public.apply_pull_request_delivery_state('https://github.com/acme/aggregate/pull/2', p_state => 'closed');
SELECT is(
  (SELECT status FROM public.issues WHERE number = 1),
  'testing',
  'pending tests surface after stronger blockers resolve'
);

SELECT public.apply_pull_request_delivery_state('https://github.com/acme/aggregate/pull/3', p_state => 'closed');
SELECT is(
  (SELECT status FROM public.issues WHERE number = 1),
  'approved',
  'the Issue is approved only when every unresolved reviewable PR is approved'
);

SELECT public.apply_pull_request_delivery_state('https://github.com/acme/aggregate/pull/4', p_review_decision => 'review_required');
SELECT is(
  (SELECT status FROM public.issues WHERE number = 1),
  'ready-for-review',
  'reviewable work without a stronger aggregate state is ready for review'
);

SELECT public.recompute_issue_status_from_pull_requests('22000000-0000-4000-8000-700000000002');
SELECT is(
  (SELECT status FROM public.issues WHERE number = 2),
  'deploying',
  'draft PRs are excluded from Issue status aggregation'
);

SELECT public.apply_pull_request_delivery_state('https://github.com/acme/aggregate/pull/6', p_state => 'open');
SELECT is(
  (SELECT status FROM public.issues WHERE number = 2),
  'changes-requested',
  'a draft begins participating as soon as it becomes reviewable'
);

SELECT public.associate_pull_request_from_webhook(
  '22000000-0000-4000-8000-700000000003',
  'https://github.com/acme/aggregate/pull/7',
  'open',
  true,
  'head-7'
);
SELECT public.apply_pull_request_delivery_state(
  'https://github.com/acme/aggregate/pull/7',
  p_ci_state => 'success',
  p_review_decision => 'changes_requested'
);
SELECT is((SELECT status FROM public.issues WHERE number = 3), 'changes-requested', 'new reviewable work reopens merged');
SELECT public.recompute_issue_status_from_pull_requests('22000000-0000-4000-8000-700000000004');
SELECT is((SELECT status FROM public.issues WHERE number = 4), 'tests-failed', 'new reviewable work reopens deploying');
SELECT public.recompute_issue_status_from_pull_requests('22000000-0000-4000-8000-700000000005');
SELECT is((SELECT status FROM public.issues WHERE number = 5), 'testing', 'new reviewable work reopens deploy-failed');
SELECT public.recompute_issue_status_from_pull_requests('22000000-0000-4000-8000-700000000006');
SELECT is((SELECT status FROM public.issues WHERE number = 6), 'approved', 'new reviewable work reopens validating');

SELECT public.recompute_issue_status_from_pull_requests('22000000-0000-4000-8000-700000000007');
SELECT is((SELECT status FROM public.issues WHERE number = 7), 'completed', 'completed is protected from PR-driven reopening');
SELECT public.recompute_issue_status_from_pull_requests('22000000-0000-4000-8000-700000000008');
SELECT is((SELECT status FROM public.issues WHERE number = 8), 'cancelled', 'cancelled is protected from PR-driven reopening');

SELECT public.apply_pull_request_delivery_state(
  'https://github.com/acme/aggregate/pull/13',
  p_ci_state => 'success',
  p_review_decision => 'changes_requested'
);
SELECT public.apply_pull_request_delivery_state(
  'https://github.com/acme/aggregate/pull/14',
  p_ci_state => 'failure',
  p_review_decision => 'approved'
);
SELECT public.apply_pull_request_delivery_state(
  'https://github.com/acme/aggregate/pull/13',
  p_review_decision => 'approved'
);

CREATE TEMP TABLE expected_delivery_order_state AS
SELECT jsonb_build_object(
  'issue_status', (SELECT status FROM public.issues WHERE number = 9),
  'pull_requests', (
    SELECT jsonb_agg(
      jsonb_build_object(
        'url', url,
        'state', state,
        'head_sha', head_sha,
        'ci_state', ci_state,
        'review_decision', review_decision
      ) ORDER BY url
    )
    FROM public.issue_pull_requests
    WHERE issue_id = '22000000-0000-4000-8000-700000000009'
  )
) AS snapshot;

UPDATE public.issues SET status = 'ready-for-review' WHERE number = 9;
UPDATE public.issue_pull_requests
   SET ci_state = 'unknown', review_decision = 'unknown'
 WHERE issue_id = '22000000-0000-4000-8000-700000000009';

SELECT public.apply_pull_request_delivery_state(
  'https://github.com/acme/aggregate/pull/14',
  p_ci_state => 'failure',
  p_review_decision => 'approved'
);
SELECT public.apply_pull_request_delivery_state(
  'https://github.com/acme/aggregate/pull/13',
  p_ci_state => 'success',
  p_review_decision => 'changes_requested'
);
SELECT public.apply_pull_request_delivery_state(
  'https://github.com/acme/aggregate/pull/13',
  p_review_decision => 'approved'
);

SELECT is(
  jsonb_build_object(
    'issue_status', (SELECT status FROM public.issues WHERE number = 9),
    'pull_requests', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'url', url,
          'state', state,
          'head_sha', head_sha,
          'ci_state', ci_state,
          'review_decision', review_decision
        ) ORDER BY url
      )
      FROM public.issue_pull_requests
      WHERE issue_id = '22000000-0000-4000-8000-700000000009'
    )
  ),
  (SELECT snapshot FROM expected_delivery_order_state),
  'equivalent cross-PR delivery orders persist identical PR and Issue state'
);

SELECT * FROM finish();
ROLLBACK;
