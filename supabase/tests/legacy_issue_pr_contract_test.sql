BEGIN;
SELECT plan(16);

SELECT ok(
  NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'issues'
       AND column_name = 'pr_url'
  ),
  'Issues no longer expose the legacy PR URL column'
);

SELECT is(
  to_regprocedure(
    'public.finish_issue_run_if_no_pending(uuid,uuid,text,timestamp with time zone,text)'
  ),
  NULL,
  'the host completion compatibility overload is removed'
);

SELECT isnt(
  to_regprocedure(
    'public.finish_issue_run_if_no_pending(uuid,uuid,text,timestamp with time zone)'
  ),
  NULL,
  'host completion exposes only the association-based signature'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.finish_issue_run_if_no_pending(uuid,uuid,text,timestamp with time zone)',
    'EXECUTE'
  ),
  'anonymous callers cannot finish an Issue run'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.finish_issue_run_if_no_pending(uuid,uuid,text,timestamp with time zone)',
    'EXECUTE'
  ),
  'authenticated callers cannot finish an Issue run'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.finish_issue_run_if_no_pending(uuid,uuid,text,timestamp with time zone)',
    'EXECUTE'
  ),
  'the service role retains host completion access'
);

SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.issue_pull_requests'::regclass),
  true,
  'Associated Pull Requests retain RLS'
);

SELECT is(
  (SELECT relreplident FROM pg_class WHERE oid = 'public.issue_pull_requests'::regclass),
  'f',
  'Associated Pull Requests retain full replica identity'
);

SELECT ok(
  EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'issue_pull_requests'
  ),
  'Associated Pull Requests remain in the realtime publication'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.issue_pull_requests', 'SELECT'),
  'authenticated callers retain association read access'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.issue_pull_requests', 'INSERT'),
  'authenticated callers cannot create webhook-owned associations'
);

SELECT ok(
  has_table_privilege('service_role', 'public.issue_pull_requests', 'INSERT'),
  'the service role retains association write access'
);

INSERT INTO public.projects (id, user_id, name, repo, key) VALUES (
  '10000000-0000-4000-8000-700000000001',
  'user_contract',
  'Contract Project',
  'acme/contract',
  'CTR'
);

INSERT INTO public.issues (
  id, project_id, title, body, status, number, active_run_id
) VALUES (
  '20000000-0000-4000-8000-700000000001',
  '10000000-0000-4000-8000-700000000001',
  'Contract issue',
  'Body',
  'in-progress',
  1,
  '30000000-0000-4000-8000-700000000001'
);

INSERT INTO public.issue_pull_requests (issue_id, url, state) VALUES (
  '20000000-0000-4000-8000-700000000001',
  'https://github.com/acme/contract/pull/1',
  'open'
);

INSERT INTO public.issue_events (issue_id, type, payload) VALUES (
  '20000000-0000-4000-8000-700000000001',
  'pr_opened',
  '{"pr_url":"https://github.com/acme/contract/pull/legacy"}'::jsonb
);

SELECT public.finish_issue_run_if_no_pending(
  '20000000-0000-4000-8000-700000000001',
  '30000000-0000-4000-8000-700000000001',
  'waiting-for-input',
  now()
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.issue_pull_requests
     WHERE issue_id = '20000000-0000-4000-8000-700000000001'
  ),
  1,
  'host completion preserves existing associations'
);

SELECT is(
  (
    SELECT payload ->> 'pr_url'
      FROM public.issue_events
     WHERE issue_id = '20000000-0000-4000-8000-700000000001'
       AND type = 'pr_opened'
  ),
  'https://github.com/acme/contract/pull/legacy',
  'historical timeline event payloads remain intact'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"user_contract"}', true);

SELECT is(
  (SELECT count(*)::integer FROM public.issue_pull_requests),
  1,
  'the Issue owner can still read associations through RLS'
);

SELECT set_config('request.jwt.claims', '{"sub":"other_user"}', true);

SELECT is(
  (SELECT count(*)::integer FROM public.issue_pull_requests),
  0,
  'another user still cannot read associations through RLS'
);

SELECT * FROM finish();
ROLLBACK;
