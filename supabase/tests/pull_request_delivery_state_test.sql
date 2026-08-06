BEGIN;
SELECT plan(26);

SELECT has_column(
  'public', 'issue_pull_requests', 'head_sha',
  'associated pull requests persist their current head'
);
SELECT has_column(
  'public', 'issue_pull_requests', 'ci_state',
  'associated pull requests persist CI state'
);
SELECT has_column(
  'public', 'issue_pull_requests', 'review_decision',
  'associated pull requests persist aggregate review state'
);
SELECT col_default_is(
  'public', 'issue_pull_requests', 'ci_state', 'unknown',
  'CI state defaults to unknown'
);
SELECT col_default_is(
  'public', 'issue_pull_requests', 'review_decision', 'unknown',
  'review state defaults to unknown'
);
SELECT ok(
  NOT has_column_privilege(
    'authenticated', 'public.issue_pull_requests', 'head_sha', 'UPDATE'
  ),
  'authenticated users cannot mutate webhook-owned head state'
);
SELECT ok(
  NOT has_column_privilege(
    'authenticated', 'public.issue_pull_requests', 'ci_state', 'UPDATE'
  ),
  'authenticated users cannot mutate webhook-owned CI state'
);
SELECT ok(
  NOT has_column_privilege(
    'authenticated', 'public.issue_pull_requests', 'review_decision', 'UPDATE'
  ),
  'authenticated users cannot mutate webhook-owned review state'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.apply_pull_request_delivery_state(text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'service role can apply signed webhook state'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.apply_pull_request_delivery_state(text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'authenticated users cannot call the webhook state RPC'
);

INSERT INTO public.projects (id, user_id, name, repo, key) VALUES
  ('11000000-0000-4000-8000-600000000001', 'user_delivery', 'Delivery Project', 'acme/base', 'GEN');

INSERT INTO public.issues (id, project_id, title, status, number, active_run_id) VALUES
  ('21000000-0000-4000-8000-600000000001', '11000000-0000-4000-8000-600000000001', 'Two PRs', 'ready-for-review', 1, NULL),
  ('21000000-0000-4000-8000-600000000002', '11000000-0000-4000-8000-600000000001', 'Draft only', 'todo', 2, NULL),
  ('21000000-0000-4000-8000-600000000003', '11000000-0000-4000-8000-600000000001', 'Closed PRs', 'ready-for-review', 3, NULL),
  ('21000000-0000-4000-8000-600000000004', '11000000-0000-4000-8000-600000000001', 'Active run', 'in-progress', 4, '31000000-0000-4000-8000-600000000004');

INSERT INTO public.issue_pull_requests (
  issue_id, url, state, head_sha, ci_state, review_decision
) VALUES
  ('21000000-0000-4000-8000-600000000001', 'https://github.com/acme/base/pull/1', 'open', 'head-1', 'success', 'changes_requested'),
  ('21000000-0000-4000-8000-600000000001', 'https://github.com/acme/base/pull/2', 'open', 'head-2', 'success', 'approved'),
  ('21000000-0000-4000-8000-600000000002', 'https://github.com/acme/base/pull/3', 'draft', 'head-3', 'failure', 'changes_requested'),
  ('21000000-0000-4000-8000-600000000003', 'https://github.com/acme/base/pull/4', 'closed', 'head-4', 'success', 'approved'),
  ('21000000-0000-4000-8000-600000000003', 'https://github.com/acme/base/pull/5', 'closed', 'head-5', 'success', 'approved'),
  ('21000000-0000-4000-8000-600000000004', 'https://github.com/acme/base/pull/6', 'open', 'head-6', 'failure', 'changes_requested');

SELECT public.recompute_issue_status_from_pull_requests(
  '21000000-0000-4000-8000-600000000001'
);
SELECT is(
  (SELECT status FROM public.issues WHERE number = 1),
  'changes-requested',
  'one active change request dominates another reviewer approval'
);

SELECT public.apply_pull_request_delivery_state(
  'https://github.com/acme/base/pull/1',
  p_review_decision => 'approved'
);
SELECT is(
  (SELECT status FROM public.issues WHERE number = 1),
  'approved',
  'all unresolved reviewable PRs must be approved'
);

SELECT public.apply_pull_request_delivery_state(
  'https://github.com/acme/base/pull/2',
  p_ci_state => 'failure'
);
SELECT is(
  (SELECT status FROM public.issues WHERE number = 1),
  'tests-failed',
  'failed CI dominates successful CI and approvals'
);

SELECT public.apply_pull_request_delivery_state(
  'https://github.com/acme/base/pull/1',
  p_ci_state => 'pending'
);
SELECT is(
  (SELECT status FROM public.issues WHERE number = 1),
  'tests-failed',
  'failed CI dominates pending CI'
);

SELECT public.apply_pull_request_delivery_state(
  'https://github.com/acme/base/pull/2',
  p_ci_state => 'success'
);
SELECT is(
  (SELECT status FROM public.issues WHERE number = 1),
  'testing',
  'pending CI is visible after stronger blockers clear'
);

SELECT public.apply_pull_request_delivery_state(
  'https://github.com/acme/base/pull/1',
  p_ci_state => 'success'
);
SELECT is(
  (SELECT status FROM public.issues WHERE number = 1),
  'approved',
  'successful CI restores the aggregate review outcome'
);

SELECT public.recompute_issue_status_from_pull_requests(
  '21000000-0000-4000-8000-600000000002'
);
SELECT is(
  (SELECT status FROM public.issues WHERE number = 2),
  'todo',
  'draft CI and review state do not affect the Issue'
);

SELECT public.apply_pull_request_delivery_state(
  'https://github.com/acme/base/pull/1',
  p_state => 'closed'
);
SELECT is(
  (SELECT status FROM public.issues WHERE number = 1),
  'approved',
  'closing one PR leaves another reviewable PR active'
);

SELECT public.apply_pull_request_delivery_state(
  'https://github.com/acme/base/pull/2',
  p_state => 'merged'
);
SELECT is(
  (SELECT status FROM public.issues WHERE number = 1),
  'merged',
  'a fully resolved set is merged when any PR merged'
);

SELECT public.recompute_issue_status_from_pull_requests(
  '21000000-0000-4000-8000-600000000003'
);
SELECT is(
  (SELECT status FROM public.issues WHERE number = 3),
  'cancelled',
  'a fully closed unmerged set is cancelled'
);

SELECT public.apply_pull_request_delivery_state(
  'https://github.com/acme/base/pull/1',
  p_head_sha => 'new-head-1'
);
SELECT is(
  (
    SELECT ci_state || ':' || review_decision
      FROM public.issue_pull_requests
     WHERE url = 'https://github.com/acme/base/pull/1'
  ),
  'unknown:unknown',
  'a new head invalidates the old head CI and review state'
);

SELECT public.apply_pull_request_delivery_state(
  'https://github.com/acme/base/pull/1',
  p_ci_state => 'failure',
  p_expected_head_sha => 'head-1'
);
SELECT is(
  (
    SELECT ci_state
      FROM public.issue_pull_requests
     WHERE url = 'https://github.com/acme/base/pull/1'
  ),
  'unknown',
  'a stale head delivery cannot overwrite current CI state'
);

SELECT public.recompute_issue_status_from_pull_requests(
  '21000000-0000-4000-8000-600000000004'
);
SELECT is(
  (SELECT status FROM public.issues WHERE number = 4),
  'in-progress',
  'webhook aggregation preserves an active run status and lease'
);

SELECT is(
  (
    SELECT active_run_id
      FROM public.issues
     WHERE number = 4
  ),
  '31000000-0000-4000-8000-600000000004'::uuid,
  'webhook aggregation does not revoke an active worker lease'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"user_delivery"}', true);

SELECT is(
  (SELECT count(*)::integer FROM public.issue_pull_requests),
  6,
  'the Issue owner can read persisted PR delivery state through RLS'
);

SELECT set_config('request.jwt.claims', '{"sub":"other_user"}', true);

SELECT is(
  (SELECT count(*)::integer FROM public.issue_pull_requests),
  0,
  'another user cannot read persisted PR delivery state through RLS'
);

SELECT * FROM finish();
ROLLBACK;
