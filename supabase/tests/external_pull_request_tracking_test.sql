BEGIN;
SELECT plan(14);

SELECT is(
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'issues'
      AND column_name = 'source'),
  '''user''::text',
  'issues created any other way stay user-sourced'
);

-- Two projects on the same account: one reviews every pull request in its
-- repository automatically, one has Automatic Review switched off.
INSERT INTO public.projects (
  id, user_id, name, repo, key, automatic_review_enabled,
  automatic_review_provider, automatic_review_model
) VALUES
  (
    '10000000-0000-4000-8000-700000000001',
    'user_external',
    'Reviewed',
    'acme/reviewed',
    'REV',
    true,
    'codex',
    'gpt-5.6-sol'
  ),
  (
    '10000000-0000-4000-8000-700000000002',
    'user_external',
    'Unreviewed',
    'acme/unreviewed',
    'UNR',
    false,
    null,
    null
  );

CREATE TEMP TABLE tracked AS
SELECT *
  FROM public.track_external_pull_request(
    '10000000-0000-4000-8000-700000000001',
    'https://github.com/acme/reviewed/pull/1',
    'open',
    true,
    'PR #1: Bump the flaky timeout',
    'Automatic Review tracking issue.',
    'head-1'
  );

SELECT is(
  (SELECT association_created FROM tracked),
  true,
  'a pull request no issue produced gets an association'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.issues
     WHERE project_id = '10000000-0000-4000-8000-700000000001'
  ),
  1,
  'tracking creates exactly one issue'
);

SELECT is(
  (
    SELECT title
      FROM public.issues
     WHERE id = (SELECT associated_issue_id FROM tracked)
  ),
  'PR #1: Bump the flaky timeout',
  'the tracking issue carries the pull request title'
);

SELECT is(
  (
    SELECT status
      FROM public.issues
     WHERE id = (SELECT associated_issue_id FROM tracked)
  ),
  'ready-for-review',
  'the tracking issue starts ready for review, never queued for an agent'
);

SELECT is(
  (
    SELECT create_pr_automatically
      FROM public.issues
     WHERE id = (SELECT associated_issue_id FROM tracked)
  ),
  false,
  'the tracking issue never publishes a pull request of its own'
);

-- What keeps failing CI and reviewer feedback from putting an agent to work
-- on a pull request that is not its to fix.
SELECT is(
  (
    SELECT source
      FROM public.issues
     WHERE id = (SELECT associated_issue_id FROM tracked)
  ),
  'external_pull_request',
  'the tracking issue is marked as one'
);

SELECT is(
  (
    SELECT number
      FROM public.issues
     WHERE id = (SELECT associated_issue_id FROM tracked)
  ),
  1,
  'the tracking issue takes the project''s next issue number'
);

SELECT is(
  (
    SELECT next_issue_number
      FROM public.projects
     WHERE id = '10000000-0000-4000-8000-700000000001'
  ),
  2,
  'the project''s issue numbering advances'
);

-- The whole point: the policy snapshot the review lifecycle reads is frozen
-- by the association, with the project's reviewer configuration.
SELECT is(
  (
    SELECT enabled
      FROM public.issue_review_policies
     WHERE issue_id = (SELECT associated_issue_id FROM tracked)
  ),
  true,
  'the tracking issue freezes an enabled review policy'
);

SELECT is(
  (
    SELECT reviewer_provider
      FROM public.issue_review_policies
     WHERE issue_id = (SELECT associated_issue_id FROM tracked)
  ),
  'codex',
  'the frozen policy uses the project reviewer'
);

-- A repeat delivery for the same pull request URL must not create a second
-- tracking issue.
CREATE TEMP TABLE replayed AS
SELECT *
  FROM public.track_external_pull_request(
    '10000000-0000-4000-8000-700000000001',
    'https://github.com/acme/reviewed/pull/1',
    'open',
    true,
    'PR #1: Bump the flaky timeout',
    'Automatic Review tracking issue.',
    'head-1'
  );

SELECT is(
  (SELECT associated_issue_id FROM replayed),
  (SELECT associated_issue_id FROM tracked),
  'a repeat delivery resolves the same tracking issue'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.issues
     WHERE project_id = '10000000-0000-4000-8000-700000000001'
  ),
  1,
  'a repeat delivery creates no second tracking issue'
);

-- A project with Automatic Review off gets no tracking issues at all: there
-- is no review to run, so the issue would be permanent noise.
SELECT is(
  (
    SELECT count(*)::integer
      FROM public.track_external_pull_request(
        '10000000-0000-4000-8000-700000000002',
        'https://github.com/acme/unreviewed/pull/1',
        'open',
        true,
        'PR #1: Unreviewed',
        'Automatic Review tracking issue.',
        'head-1'
      )
  ),
  0,
  'a project without automatic review tracks nothing'
);

ROLLBACK;
