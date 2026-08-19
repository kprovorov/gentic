BEGIN;
SELECT plan(32);

-- Two workers and one issue owned by the same user, so the ownership trigger's
-- `ensure_issue_active_worker_owner` check is satisfied throughout.
INSERT INTO public.workers (
  id, user_id, display_name, credential_hash, setup_state, last_seen_at,
  provider_capabilities
) VALUES
  ('00000000-0000-4000-8000-412000000001', 'user_gen412', 'Worker A',
   repeat('a', 64), 'ready', '2026-08-19T09:00:00Z', '{"providers":{}}'::jsonb),
  ('00000000-0000-4000-8000-412000000002', 'user_gen412', 'Worker B',
   repeat('c', 64), 'ready', '2026-08-19T09:00:00Z', '{"providers":{}}'::jsonb);

INSERT INTO public.projects (id, user_id, name, repo, key)
VALUES ('10000000-0000-4000-8000-412000000001', 'user_gen412',
        'GEN-412 Project', 'gentic/gen412', 'GFR');

-- A live implementation run: lease held by Worker A, no session persisted yet.
INSERT INTO public.issues (
  id, project_id, title, body, status, number, agent_provider,
  active_worker_id, active_run_id
) VALUES (
  '20000000-0000-4000-8000-412000000001',
  '10000000-0000-4000-8000-412000000001',
  'Implement the thing', 'Body', 'in-progress', 1, 'claude_code',
  '00000000-0000-4000-8000-412000000001',
  '30000000-0000-4000-8000-412000000001'
);

-- No session yet -> no owner yet.
SELECT is(
  (SELECT count(*)::integer FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'),
  0,
  'a live run with no session has not established an owner'
);

-- === Establishment ===
UPDATE public.issues SET session_id = 'sess-1'
 WHERE id = '20000000-0000-4000-8000-412000000001';

SELECT is(
  (SELECT count(*)::integer FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND superseded_at IS NULL),
  1,
  'persisting a session establishes exactly one current owner'
);
SELECT is(
  (SELECT generation FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND superseded_at IS NULL),
  1, 'the first owner is generation 1'
);
SELECT is(
  (SELECT origin FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND superseded_at IS NULL),
  'implementation', 'the first owner originates from implementation'
);
SELECT is(
  (SELECT worker_id FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND superseded_at IS NULL),
  '00000000-0000-4000-8000-412000000001'::uuid,
  'the owner is bound to the running worker'
);
SELECT is(
  (SELECT session_id FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND superseded_at IS NULL),
  'sess-1', 'the owner records the resume handle'
);

-- === Reconnect / restart: same worker, new run, refreshed session ===
-- Run finishes (lease released), then the same worker re-claims and resumes.
UPDATE public.issues SET status = 'waiting-for-input'
 WHERE id = '20000000-0000-4000-8000-412000000001';
UPDATE public.issues
   SET status = 'queued',
       active_run_id = '30000000-0000-4000-8000-412000000002',
       active_worker_id = '00000000-0000-4000-8000-412000000001'
 WHERE id = '20000000-0000-4000-8000-412000000001';
UPDATE public.issues SET session_id = 'sess-2'
 WHERE id = '20000000-0000-4000-8000-412000000001';

SELECT is(
  (SELECT generation FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND superseded_at IS NULL),
  1, 'the same worker resuming keeps the same owner generation'
);
SELECT is(
  (SELECT session_id FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND superseded_at IS NULL),
  'sess-2', 'resuming refreshes the resume handle'
);
SELECT is(
  (SELECT worker_id FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND superseded_at IS NULL),
  '00000000-0000-4000-8000-412000000001'::uuid,
  'the owner is still resolvable after a restart'
);
SELECT is(
  (SELECT count(*)::integer FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND superseded_at IS NULL),
  1, 'restart never forks a second current owner'
);

-- === Lease expiry (offline reconciliation) preserves ownership ===
UPDATE public.issues
   SET status = 'run-failed',
       active_run_id = NULL,
       active_worker_id = NULL,
       run_error = 'Assigned worker went offline'
 WHERE id = '20000000-0000-4000-8000-412000000001';

SELECT is(
  (SELECT worker_id FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND superseded_at IS NULL),
  '00000000-0000-4000-8000-412000000001'::uuid,
  'lease expiry leaves the implementation owner intact'
);
SELECT is(
  (SELECT session_id FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND superseded_at IS NULL),
  'sess-2', 'lease expiry keeps the resume handle'
);

-- === Worker reassignment does not change ownership ===
-- A different worker claims and even persists its own session; ownership stays.
UPDATE public.issues
   SET status = 'queued',
       active_run_id = '30000000-0000-4000-8000-412000000003',
       active_worker_id = '00000000-0000-4000-8000-412000000002'
 WHERE id = '20000000-0000-4000-8000-412000000001';
UPDATE public.issues SET session_id = 'sess-3'
 WHERE id = '20000000-0000-4000-8000-412000000001';

SELECT is(
  (SELECT worker_id FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND superseded_at IS NULL),
  '00000000-0000-4000-8000-412000000001'::uuid,
  'a different worker running the issue does not take ownership'
);
SELECT is(
  (SELECT session_id FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND superseded_at IS NULL),
  'sess-2', 'a non-owner worker does not overwrite the resume handle'
);

-- === Fresh implementation transition ===
SELECT public.start_fresh_implementation(
  'user_gen412', '20000000-0000-4000-8000-412000000001'::uuid,
  '2026-08-19T10:00:00Z'
);

SELECT isnt(
  (SELECT superseded_at FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND generation = 1),
  NULL, 'a fresh implementation supersedes the previous owner'
);
SELECT is(
  (SELECT generation FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND superseded_at IS NULL),
  2, 'a fresh implementation establishes a new generation'
);
SELECT is(
  (SELECT origin FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND superseded_at IS NULL),
  'fresh_implementation', 'the new owner records the fresh-implementation origin'
);
SELECT is(
  (SELECT worker_id FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND superseded_at IS NULL),
  NULL, 'the fresh owner starts unbound'
);
SELECT is(
  (SELECT session_id FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND superseded_at IS NULL),
  NULL, 'the fresh owner has no session yet'
);
SELECT is(
  (SELECT status FROM public.issues
    WHERE id = '20000000-0000-4000-8000-412000000001'),
  'todo', 'a fresh implementation re-queues the issue'
);
SELECT is(
  (SELECT session_id FROM public.issues
    WHERE id = '20000000-0000-4000-8000-412000000001'),
  NULL, 'a fresh implementation clears the issue session'
);
SELECT is(
  (SELECT active_run_id FROM public.issues
    WHERE id = '20000000-0000-4000-8000-412000000001'),
  NULL, 'a fresh implementation clears the run lease'
);
SELECT is(
  (SELECT count(*)::integer FROM public.issue_events
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND type = 'implementation_ownership_reset'),
  1, 'a fresh implementation is audited as an ownership reset'
);
SELECT is(
  (SELECT count(*)::integer FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND superseded_at IS NULL),
  1, 'exactly one current owner survives a fresh implementation'
);

-- === The fresh owner binds to the next run (from any worker) ===
UPDATE public.issues
   SET status = 'queued',
       active_run_id = '30000000-0000-4000-8000-412000000004',
       active_worker_id = '00000000-0000-4000-8000-412000000002'
 WHERE id = '20000000-0000-4000-8000-412000000001';

SELECT is(
  (SELECT worker_id FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND superseded_at IS NULL),
  NULL, 'claiming without a session does not bind the fresh owner'
);

UPDATE public.issues SET session_id = 'sess-4'
 WHERE id = '20000000-0000-4000-8000-412000000001';

SELECT is(
  (SELECT worker_id FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND superseded_at IS NULL AND generation = 2),
  '00000000-0000-4000-8000-412000000002'::uuid,
  'the fresh owner binds to the first run that brings a session'
);

-- === Concurrent resume vs. fresh implementation resolve to one owner ===
SELECT public.start_fresh_implementation(
  'user_gen412', '20000000-0000-4000-8000-412000000001'::uuid,
  '2026-08-19T11:00:00Z'
);
-- The old owner's late resume, gated on the run lease this cleared, no-ops.
UPDATE public.issues SET session_id = 'sess-late'
 WHERE id = '20000000-0000-4000-8000-412000000001'
   AND active_run_id = '30000000-0000-4000-8000-412000000004'
   AND active_worker_id = '00000000-0000-4000-8000-412000000002';

SELECT is(
  (SELECT session_id FROM public.issues
    WHERE id = '20000000-0000-4000-8000-412000000001'),
  NULL, 'a late resume of the superseded owner cannot re-bind after a fresh start'
);
SELECT is(
  (SELECT count(*)::integer FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND superseded_at IS NULL),
  1, 'resume and fresh implementation resolve to a single current owner'
);
SELECT is(
  (SELECT generation FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000001'
      AND superseded_at IS NULL),
  3, 'the fresh implementation is the surviving owner'
);

-- === Clearing the session (reset / provider change) supersedes ownership ===
INSERT INTO public.issues (
  id, project_id, title, body, status, number, agent_provider,
  active_worker_id, active_run_id, session_id
) VALUES (
  '20000000-0000-4000-8000-412000000002',
  '10000000-0000-4000-8000-412000000001',
  'Second issue', 'Body', 'in-progress', 2, 'claude_code',
  '00000000-0000-4000-8000-412000000001',
  '30000000-0000-4000-8000-412000000005',
  'sess-x'
);

SELECT is(
  (SELECT count(*)::integer FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000002'
      AND superseded_at IS NULL),
  1, 'inserting an issue with a live session establishes its owner'
);

UPDATE public.issues SET session_id = NULL
 WHERE id = '20000000-0000-4000-8000-412000000002';

SELECT is(
  (SELECT count(*)::integer FROM public.issue_implementation_owners
    WHERE issue_id = '20000000-0000-4000-8000-412000000002'
      AND superseded_at IS NULL),
  0, 'clearing the session supersedes the current owner'
);

-- === Authorization ===
SELECT throws_ok(
  $$ SELECT public.start_fresh_implementation(
       'user_someone_else',
       '20000000-0000-4000-8000-412000000002'::uuid,
       now()
     ) $$,
  'P0002',
  'Issue not found',
  'a fresh implementation for another user''s issue is rejected'
);

SELECT * FROM finish();
ROLLBACK;
