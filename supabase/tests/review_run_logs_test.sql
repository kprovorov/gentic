BEGIN;
SELECT plan(8);

SELECT has_table('public', 'review_run_logs', 'review_run_logs table exists');

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

INSERT INTO public.review_runs (id, review_cycle_id, status) VALUES
  ('50000000-0000-4000-8000-000000000e01', '40000000-0000-4000-8000-000000000d01', 'running');

SELECT lives_ok(
  $$
    INSERT INTO public.review_run_logs (review_run_id, seq, role, content)
    VALUES ('50000000-0000-4000-8000-000000000e01', 1, 'assistant', 'Cloning repo at exact SHA')
  $$,
  'a log line for a review run is accepted'
);

SELECT throws_ok(
  $$
    INSERT INTO public.review_run_logs (review_run_id, seq, role, content)
    VALUES ('50000000-0000-4000-8000-000000000e01', 1, 'assistant', 'duplicate seq')
  $$,
  '23505',
  null,
  'a duplicate seq for the same review run is rejected'
);

SELECT throws_ok(
  $$
    INSERT INTO public.review_run_logs (review_run_id, seq, role, content)
    VALUES ('50000000-0000-4000-8000-000000000e01', 2, 'user', 'not a valid role')
  $$,
  '23514',
  null,
  'an invalid role is rejected'
);

SELECT throws_ok(
  $$
    INSERT INTO public.review_run_logs (review_run_id, seq, role, content)
    VALUES ('50000000-0000-4000-8000-000000000e01', 0, 'assistant', 'non-positive seq')
  $$,
  '23514',
  null,
  'a non-positive seq is rejected'
);

-- Cascading retention: deleting the run removes its logs.
DELETE FROM public.review_runs WHERE id = '50000000-0000-4000-8000-000000000e01';

SELECT is(
  (SELECT count(*)::integer FROM public.review_run_logs
    WHERE review_run_id = '50000000-0000-4000-8000-000000000e01'),
  0,
  'deleting a review run cascades to its logs'
);

-- RLS: logs are readable exactly where the owning issue is.
INSERT INTO public.review_runs (id, review_cycle_id, status) VALUES
  ('50000000-0000-4000-8000-000000000e02', '40000000-0000-4000-8000-000000000d01', 'running');
INSERT INTO public.review_run_logs (review_run_id, seq, role, content) VALUES
  ('50000000-0000-4000-8000-000000000e02', 1, 'assistant', 'Reviewing diff');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"user_alpha"}', true);
SELECT is(
  (SELECT count(*)::integer FROM public.review_run_logs),
  1,
  'issue owner can read their review run logs'
);
SELECT set_config('request.jwt.claims', '{"sub":"user_beta"}', true);
SELECT is(
  (SELECT count(*)::integer FROM public.review_run_logs),
  0,
  'other users cannot read review run logs'
);

SELECT * FROM finish();
ROLLBACK;
