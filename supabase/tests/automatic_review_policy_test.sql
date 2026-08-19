BEGIN;
SELECT plan(18);

SELECT has_column(
  'public',
  'projects',
  'automatic_review_enabled',
  'projects has automatic_review_enabled'
);
SELECT has_column(
  'public',
  'issues',
  'automatic_review_enabled',
  'issues has automatic_review_enabled override'
);
SELECT has_table(
  'public',
  'issue_review_policies',
  'issue review policy snapshot table exists'
);

-- Defaults: a fresh Project keeps Automatic Review disabled.
INSERT INTO public.projects (id, user_id, name, repo, key) VALUES
  ('10000000-0000-4000-8000-000000000901', 'user_alpha', 'Default', 'gentic/default', 'DEF');

SELECT is(
  (
    SELECT automatic_review_enabled
      FROM public.projects
     WHERE id = '10000000-0000-4000-8000-000000000901'
  ),
  false,
  'new projects default automatic_review_enabled to false'
);

-- The `reviewing` status is accepted.
SELECT lives_ok(
  $$
    INSERT INTO public.issues (project_id, title, body, status, number)
    VALUES (
      '10000000-0000-4000-8000-000000000901',
      'Reviewing issue',
      'Body',
      'reviewing',
      1
    )
  $$,
  'issues accept the reviewing status'
);

-- Project 1: review enabled, explicit provider, model "Same as Issue".
INSERT INTO public.projects (
  id, user_id, name, repo, key,
  automatic_review_enabled, automatic_review_provider,
  automatic_review_model, automatic_review_instructions
) VALUES (
  '10000000-0000-4000-8000-000000000902', 'user_alpha', 'Alpha', 'gentic/alpha', 'ALP',
  true, 'codex', null, 'Focus areas'
);

INSERT INTO public.issues (
  id, project_id, title, body, status, number, agent_provider, issue_model
) VALUES (
  '20000000-0000-4000-8000-000000000902',
  '10000000-0000-4000-8000-000000000902',
  'Alpha issue', 'Body', 'draft', 1, 'claude_code', 'sonnet'
);

-- First associated pull request freezes the effective policy.
INSERT INTO public.issue_pull_requests (issue_id, url, state, head_sha) VALUES
  ('20000000-0000-4000-8000-000000000902', 'https://gh/alpha/pull/1', 'open', 'sha-a1');

SELECT is(
  (SELECT enabled FROM public.issue_review_policies
    WHERE issue_id = '20000000-0000-4000-8000-000000000902'),
  true,
  'policy snapshot inherits the project enablement'
);
SELECT is(
  (SELECT reviewer_provider FROM public.issue_review_policies
    WHERE issue_id = '20000000-0000-4000-8000-000000000902'),
  'codex',
  'policy snapshot takes the project reviewer provider'
);
SELECT is(
  (SELECT reviewer_model FROM public.issue_review_policies
    WHERE issue_id = '20000000-0000-4000-8000-000000000902'),
  'sonnet',
  'a "Same as Issue" project model resolves to the issue model'
);
SELECT is(
  (SELECT reviewer_instructions FROM public.issue_review_policies
    WHERE issue_id = '20000000-0000-4000-8000-000000000902'),
  'Focus areas',
  'policy snapshot captures reviewer instructions'
);

-- A second pull request must not re-snapshot the policy.
INSERT INTO public.issue_pull_requests (issue_id, url, state, head_sha) VALUES
  ('20000000-0000-4000-8000-000000000902', 'https://gh/alpha/pull/2', 'open', 'sha-a2');

SELECT is(
  (SELECT count(*)::integer FROM public.issue_review_policies
    WHERE issue_id = '20000000-0000-4000-8000-000000000902'),
  1,
  'only the first pull request snapshots the policy'
);

-- The snapshot is immutable once captured.
SELECT throws_ok(
  $$
    UPDATE public.issue_review_policies
       SET enabled = false
     WHERE issue_id = '20000000-0000-4000-8000-000000000902'
  $$,
  '23514',
  null,
  'policy snapshot fields are immutable'
);

-- Project 2: review enabled, provider "Same as Issue", explicit model. The Issue
-- overrides enablement to false before any pull request exists.
INSERT INTO public.projects (
  id, user_id, name, repo, key,
  automatic_review_enabled, automatic_review_provider, automatic_review_model
) VALUES (
  '10000000-0000-4000-8000-000000000903', 'user_alpha', 'Beta', 'gentic/beta', 'BET',
  true, null, 'opus'
);

INSERT INTO public.issues (
  id, project_id, title, body, status, number, agent_provider, issue_model
) VALUES (
  '20000000-0000-4000-8000-000000000903',
  '10000000-0000-4000-8000-000000000903',
  'Beta issue', 'Body', 'draft', 1, 'codex', null
);

-- The override is mutable before the first pull request.
SELECT lives_ok(
  $$
    UPDATE public.issues
       SET automatic_review_enabled = false
     WHERE id = '20000000-0000-4000-8000-000000000903'
  $$,
  'issue review override is mutable before the first pull request'
);

INSERT INTO public.issue_pull_requests (issue_id, url, state, head_sha) VALUES
  ('20000000-0000-4000-8000-000000000903', 'https://gh/beta/pull/1', 'open', 'sha-b1');

SELECT is(
  (SELECT enabled FROM public.issue_review_policies
    WHERE issue_id = '20000000-0000-4000-8000-000000000903'),
  false,
  'the issue override wins over the project enablement in the snapshot'
);
SELECT is(
  (SELECT reviewer_provider FROM public.issue_review_policies
    WHERE issue_id = '20000000-0000-4000-8000-000000000903'),
  'codex',
  'a "Same as Issue" project provider resolves to the issue provider'
);
SELECT is(
  (SELECT reviewer_model FROM public.issue_review_policies
    WHERE issue_id = '20000000-0000-4000-8000-000000000903'),
  'opus',
  'an explicit project model overrides the issue model'
);

-- The override is locked once the first pull request is associated.
SELECT throws_ok(
  $$
    UPDATE public.issues
       SET automatic_review_enabled = true
     WHERE id = '20000000-0000-4000-8000-000000000903'
  $$,
  '23514',
  null,
  'issue review override cannot change after the first pull request'
);

-- RLS: review policy is readable exactly where the owning issue is.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"user_alpha"}', true);
SELECT is(
  (SELECT count(*)::integer FROM public.issue_review_policies),
  2,
  'issue owner can read their review policies'
);
SELECT set_config('request.jwt.claims', '{"sub":"user_beta"}', true);
SELECT is(
  (SELECT count(*)::integer FROM public.issue_review_policies),
  0,
  'other users cannot read review policies'
);

SELECT * FROM finish();
ROLLBACK;
