BEGIN;
SELECT plan(5);

SELECT has_column('public', 'review_findings', 'evidence', 'review_findings has an evidence column');
SELECT has_column('public', 'review_findings', 'impact', 'review_findings has an impact column');
SELECT has_column('public', 'review_findings', 'requested_change', 'review_findings has a requested_change column');

INSERT INTO public.projects (id, user_id, name, repo, key) VALUES
  ('10000000-0000-4000-8000-000000000a01', 'user_alpha', 'Alpha', 'gentic/alpha', 'ALP');
INSERT INTO public.issues (id, project_id, title, body, status, number) VALUES
  ('20000000-0000-4000-8000-000000000b01', '10000000-0000-4000-8000-000000000a01',
   'Issue one', 'Body', 'reviewing', 1);
INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha) VALUES
  ('30000000-0000-4000-8000-000000000c01', '20000000-0000-4000-8000-000000000b01',
   'https://gh/alpha/pull/1', 'open', 'sha1');
INSERT INTO public.review_cycles (id, issue_id, pull_request_id, head_sha) VALUES
  ('40000000-0000-4000-8000-000000000d01', '20000000-0000-4000-8000-000000000b01',
   '30000000-0000-4000-8000-000000000c01', 'sha1');
INSERT INTO public.review_runs (id, review_cycle_id, status, head_sha) VALUES
  ('50000000-0000-4000-8000-000000000e01', '40000000-0000-4000-8000-000000000d01', 'completed', 'sha1');
INSERT INTO public.review_attempts (id, review_cycle_id, review_run_id, attempt_number, verdict) VALUES
  ('60000000-0000-4000-8000-000000000f01', '40000000-0000-4000-8000-000000000d01',
   '50000000-0000-4000-8000-000000000e01', 1, 'changes_requested');

SELECT lives_ok(
  $$
    INSERT INTO public.review_findings
      (review_attempt_id, head_sha, severity, title, evidence, impact, requested_change)
    VALUES ('60000000-0000-4000-8000-000000000f01', 'sha1', 'blocker', 'Null deref on empty input',
            'line 42 dereferences `user.email` without a null check',
            'crashes the request handler on any anonymous request',
            'add a null check before dereferencing `user.email`')
  $$,
  'a finding with defect/evidence/impact/requested_change fields is accepted'
);

-- `complete_review_attempt` persists evidence/impact/requested_change from
-- the jsonb findings array it's called with.
INSERT INTO public.review_cycles (id, issue_id, pull_request_id, head_sha) VALUES
  ('40000000-0000-4000-8000-000000000d02', '20000000-0000-4000-8000-000000000b01',
   '30000000-0000-4000-8000-000000000c01', 'sha2');
INSERT INTO public.review_runs (id, review_cycle_id, status, head_sha) VALUES
  ('50000000-0000-4000-8000-000000000e02', '40000000-0000-4000-8000-000000000d02', 'running', 'sha2');

SELECT public.complete_review_attempt(
  '50000000-0000-4000-8000-000000000e02',
  'changes_requested',
  null,
  null,
  '[{"severity":"blocker","title":"Unbounded recursion","evidence":"foo() calls itself with no base case","impact":"stack overflow on any nonempty input","requested_change":"add a base case"}]'::jsonb
);

SELECT is(
  (SELECT requested_change FROM public.review_findings
    WHERE review_attempt_id = (
      SELECT id FROM public.review_attempts
       WHERE review_run_id = '50000000-0000-4000-8000-000000000e02'
    )),
  'add a base case',
  'complete_review_attempt persists evidence/impact/requested_change from its jsonb findings input'
);

SELECT * FROM finish();
ROLLBACK;
