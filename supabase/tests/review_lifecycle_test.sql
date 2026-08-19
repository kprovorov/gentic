BEGIN;
SELECT plan(23);

SELECT has_table('public', 'review_cycles', 'review_cycles table exists');
SELECT has_table('public', 'review_runs', 'review_runs table exists');
SELECT has_table('public', 'review_attempts', 'review_attempts table exists');
SELECT has_table('public', 'review_findings', 'review_findings table exists');

INSERT INTO public.projects (id, user_id, name, repo, key) VALUES
  ('10000000-0000-4000-8000-000000000a01', 'user_alpha', 'Alpha', 'gentic/alpha', 'ALP');

INSERT INTO public.issues (id, project_id, title, body, status, number) VALUES
  ('20000000-0000-4000-8000-000000000b01', '10000000-0000-4000-8000-000000000a01',
   'Issue one', 'Body', 'reviewing', 1),
  ('20000000-0000-4000-8000-000000000b02', '10000000-0000-4000-8000-000000000a01',
   'Issue two', 'Body', 'draft', 2);

INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha) VALUES
  ('30000000-0000-4000-8000-000000000c01', '20000000-0000-4000-8000-000000000b01',
   'https://gh/alpha/pull/1', 'open', 'sha1'),
  ('30000000-0000-4000-8000-000000000c03', '20000000-0000-4000-8000-000000000b01',
   'https://gh/alpha/pull/3', 'draft', 'sha1');

-- An active cycle per (pull request, head SHA).
SELECT lives_ok(
  $$
    INSERT INTO public.review_cycles (id, issue_id, pull_request_id, head_sha)
    VALUES ('40000000-0000-4000-8000-000000000d01',
            '20000000-0000-4000-8000-000000000b01',
            '30000000-0000-4000-8000-000000000c01', 'sha1')
  $$,
  'an active review cycle can be created for a pull request head SHA'
);

SELECT throws_ok(
  $$
    INSERT INTO public.review_cycles (issue_id, pull_request_id, head_sha)
    VALUES ('20000000-0000-4000-8000-000000000b01',
            '30000000-0000-4000-8000-000000000c01', 'sha1')
  $$,
  '23505',
  null,
  'a second active cycle for the same pull request head SHA is rejected'
);

-- A different head SHA is a distinct cycle.
SELECT lives_ok(
  $$
    INSERT INTO public.review_cycles (id, issue_id, pull_request_id, head_sha)
    VALUES ('40000000-0000-4000-8000-000000000d02',
            '20000000-0000-4000-8000-000000000b01',
            '30000000-0000-4000-8000-000000000c01', 'sha2')
  $$,
  'a new head SHA gets its own active cycle'
);

-- Cross-issue association is rejected: the pull request belongs to issue one.
SELECT throws_ok(
  $$
    INSERT INTO public.review_cycles (issue_id, pull_request_id, head_sha)
    VALUES ('20000000-0000-4000-8000-000000000b02',
            '30000000-0000-4000-8000-000000000c01', 'sha1')
  $$,
  '23514',
  null,
  'a cycle whose pull request belongs to another issue is rejected'
);

-- An active run is allowed on an open pull request.
SELECT lives_ok(
  $$
    INSERT INTO public.review_runs (id, review_cycle_id, status)
    VALUES ('50000000-0000-4000-8000-000000000e01',
            '40000000-0000-4000-8000-000000000d01', 'pending')
  $$,
  'an active run is allowed on a non-draft pull request'
);

-- Draft pull requests cannot hold an active run.
INSERT INTO public.review_cycles (id, issue_id, pull_request_id, head_sha) VALUES
  ('40000000-0000-4000-8000-000000000d03', '20000000-0000-4000-8000-000000000b01',
   '30000000-0000-4000-8000-000000000c03', 'sha1');

SELECT throws_ok(
  $$
    INSERT INTO public.review_runs (review_cycle_id, status)
    VALUES ('40000000-0000-4000-8000-000000000d03', 'pending')
  $$,
  '23514',
  null,
  'a draft pull request cannot have an active review run'
);

-- Supporting runs for the attempt tests.
INSERT INTO public.review_runs (id, review_cycle_id, status) VALUES
  ('50000000-0000-4000-8000-000000000e02', '40000000-0000-4000-8000-000000000d01', 'completed'),
  ('50000000-0000-4000-8000-000000000e03', '40000000-0000-4000-8000-000000000d01', 'completed'),
  ('50000000-0000-4000-8000-000000000e04', '40000000-0000-4000-8000-000000000d01', 'completed'),
  ('50000000-0000-4000-8000-000000000e05', '40000000-0000-4000-8000-000000000d01', 'completed'),
  ('50000000-0000-4000-8000-000000000e06', '40000000-0000-4000-8000-000000000d01', 'completed');

-- Three completed attempts per cycle.
SELECT lives_ok(
  $$
    INSERT INTO public.review_attempts
      (id, review_cycle_id, review_run_id, attempt_number, verdict)
    VALUES ('60000000-0000-4000-8000-000000000f01',
            '40000000-0000-4000-8000-000000000d01',
            '50000000-0000-4000-8000-000000000e01', 1, 'changes_requested')
  $$,
  'the first attempt is accepted'
);
SELECT lives_ok(
  $$
    INSERT INTO public.review_attempts
      (review_cycle_id, review_run_id, attempt_number, verdict)
    VALUES ('40000000-0000-4000-8000-000000000d01',
            '50000000-0000-4000-8000-000000000e02', 2, 'changes_requested')
  $$,
  'the second attempt is accepted'
);
SELECT lives_ok(
  $$
    INSERT INTO public.review_attempts
      (review_cycle_id, review_run_id, attempt_number, verdict)
    VALUES ('40000000-0000-4000-8000-000000000d01',
            '50000000-0000-4000-8000-000000000e03', 3, 'changes_requested')
  $$,
  'the third attempt is accepted'
);

-- A fourth attempt exceeds the limit.
SELECT throws_ok(
  $$
    INSERT INTO public.review_attempts
      (review_cycle_id, review_run_id, attempt_number, verdict)
    VALUES ('40000000-0000-4000-8000-000000000d01',
            '50000000-0000-4000-8000-000000000e04', 4, 'changes_requested')
  $$,
  '23514',
  null,
  'a cycle cannot exceed three completed attempts'
);

-- Reusing an attempt number is rejected.
SELECT throws_ok(
  $$
    INSERT INTO public.review_attempts
      (review_cycle_id, review_run_id, attempt_number, verdict)
    VALUES ('40000000-0000-4000-8000-000000000d01',
            '50000000-0000-4000-8000-000000000e05', 1, 'approved')
  $$,
  '23505',
  null,
  'attempt numbers are unique within a cycle'
);

-- An attempt's cycle must match its run's cycle.
SELECT throws_ok(
  $$
    INSERT INTO public.review_attempts
      (review_cycle_id, review_run_id, attempt_number, verdict)
    VALUES ('40000000-0000-4000-8000-000000000d02',
            '50000000-0000-4000-8000-000000000e06', 1, 'approved')
  $$,
  '23514',
  null,
  'an attempt cycle must match its run cycle'
);

-- Findings pin to the exact head SHA of the attempt's cycle.
SELECT lives_ok(
  $$
    INSERT INTO public.review_findings
      (review_attempt_id, head_sha, severity, title)
    VALUES ('60000000-0000-4000-8000-000000000f01', 'sha1', 'warning', 'Null deref')
  $$,
  'a finding matching the cycle head SHA is accepted'
);
SELECT throws_ok(
  $$
    INSERT INTO public.review_findings
      (review_attempt_id, head_sha, severity, title)
    VALUES ('60000000-0000-4000-8000-000000000f01', 'other-sha', 'warning', 'Wrong SHA')
  $$,
  '23514',
  null,
  'a finding with a mismatched head SHA is rejected'
);

-- Cascading retention: deleting a cycle removes its runs, attempts, and findings.
DELETE FROM public.review_cycles WHERE id = '40000000-0000-4000-8000-000000000d01';

SELECT is(
  (SELECT count(*)::integer FROM public.review_runs
    WHERE review_cycle_id = '40000000-0000-4000-8000-000000000d01'),
  0,
  'deleting a cycle cascades to its runs'
);
SELECT is(
  (SELECT count(*)::integer FROM public.review_attempts
    WHERE review_cycle_id = '40000000-0000-4000-8000-000000000d01'),
  0,
  'deleting a cycle cascades to its attempts'
);
SELECT is(
  (SELECT count(*)::integer FROM public.review_findings
    WHERE review_attempt_id = '60000000-0000-4000-8000-000000000f01'),
  0,
  'deleting a cycle cascades to its findings'
);

-- RLS: review state is readable exactly where the owning issue is.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"user_alpha"}', true);
SELECT is(
  (SELECT count(*)::integer FROM public.review_cycles),
  2,
  'issue owner can read their review cycles'
);
SELECT set_config('request.jwt.claims', '{"sub":"user_beta"}', true);
SELECT is(
  (SELECT count(*)::integer FROM public.review_cycles),
  0,
  'other users cannot read review cycles'
);

SELECT * FROM finish();
ROLLBACK;
