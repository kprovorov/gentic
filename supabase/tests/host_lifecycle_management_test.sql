BEGIN;
SELECT plan(40);

INSERT INTO public.hosts (
  id,
  user_id,
  display_name,
  credential_hash,
  setup_state,
  last_seen_at,
  provider_capabilities
) VALUES
  (
    '00000000-0000-4000-8000-100000000001',
    'user_alpha',
    'Alpha One',
    repeat('a', 64),
    'ready',
    '2026-07-29T20:00:00Z',
    '{"providers":{}}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-100000000002',
    'user_alpha',
    'Alpha Two',
    repeat('b', 64),
    'ready',
    '2026-07-29T20:00:00Z',
    '{"providers":{}}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-100000000003',
    'user_beta',
    'Beta One',
    repeat('c', 64),
    'ready',
    '2026-07-29T20:00:00Z',
    '{"providers":{}}'::jsonb
  );

SELECT is(
  (
    SELECT display_name
      FROM public.rename_host(
        'user_alpha',
        '00000000-0000-4000-8000-100000000001',
        '  Beta   One  ',
        '2026-07-29T20:01:00Z'
      )
  ),
  'Beta One',
  'rename trims and compacts display names'
);

SELECT throws_ok(
  $$
    SELECT public.rename_host(
      'user_alpha',
      '00000000-0000-4000-8000-100000000001',
      'alpha two',
      '2026-07-29T20:02:00Z'
    )
  $$,
  '23505',
  null,
  'rename rejects case-insensitive collisions for the same owner'
);

SELECT is(
  (
    SELECT id
      FROM public.rename_host(
        'user_alpha',
        '00000000-0000-4000-8000-100000000003',
        'Hidden',
        '2026-07-29T20:03:00Z'
      )
  ),
  null,
  'rename does not reveal another user host'
);

SELECT throws_ok(
  $$
    INSERT INTO public.hosts (
      user_id,
      display_name,
      credential_hash,
      provider_capabilities
    ) VALUES (
      'user_alpha',
      repeat('x', 81),
      repeat('d', 64),
      '{"providers":{}}'::jsonb
    )
  $$,
  '23514',
  null,
  'host names over 80 characters are rejected'
);

INSERT INTO public.projects (
  id,
  user_id,
  name,
  repo,
  key
) VALUES (
  '10000000-0000-4000-8000-100000000001',
  'user_alpha',
  'Alpha Project',
  'gentic/alpha',
  'ALP'
);

INSERT INTO public.issues (
  id,
  project_id,
  title,
  body,
  status,
  number,
  active_host_id,
  active_run_id,
  session_id,
  run_error,
  run_started_at
) VALUES
  (
    '20000000-0000-4000-8000-100000000001',
    '10000000-0000-4000-8000-100000000001',
    'Active task',
    'Body',
    'in-progress',
    1,
    '00000000-0000-4000-8000-100000000001',
    '30000000-0000-4000-8000-100000000001',
    'session-1',
    'old error',
    '2026-07-29T19:55:00Z'
  ),
  (
    '20000000-0000-4000-8000-100000000002',
    '10000000-0000-4000-8000-100000000001',
    'Failed task',
    'Body',
    'run-failed',
    2,
    '00000000-0000-4000-8000-100000000001',
    '30000000-0000-4000-8000-100000000002',
    'session-2',
    'failed',
    '2026-07-29T19:50:00Z'
  );

INSERT INTO public.issue_pull_requests (issue_id, url) VALUES
  (
    '20000000-0000-4000-8000-100000000001',
    'https://github.com/gentic/alpha/pull/1'
  ),
  (
    '20000000-0000-4000-8000-100000000002',
    'https://github.com/gentic/alpha/pull/2'
  );

INSERT INTO public.messages (
  id,
  issue_id,
  role,
  content,
  consumed_by_run_id,
  consumed_at
) VALUES (
  '40000000-0000-4000-8000-100000000001',
  '20000000-0000-4000-8000-100000000001',
  'user',
  'Please continue',
  '30000000-0000-4000-8000-100000000001',
  '2026-07-29T19:56:00Z'
);

-- A review job (GEN-414) claimed by the same host must also be released
-- on ban — `reconcile_offline_review_runs` deliberately excludes banned
-- hosts, so `ban_host` is the only thing that ever frees this claim.
UPDATE public.projects
   SET automatic_review_enabled = true
 WHERE id = '10000000-0000-4000-8000-100000000001';

INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider) VALUES
  ('20000000-0000-4000-8000-100000000003', '10000000-0000-4000-8000-100000000001', 'Review job task', 'Body', 'ready-for-review', 3, 'claude_code');

INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('20000000-0000-4000-8000-100000000103', '20000000-0000-4000-8000-100000000003', 'https://github.com/gentic/alpha/pull/3', 'open', 'sha-ban', 'success');

SELECT public.evaluate_review_eligibility('https://github.com/gentic/alpha/pull/3');

CREATE TEMP TABLE ban_review_claim AS
SELECT * FROM public.claim_review_run('00000000-0000-4000-8000-100000000001', 'user_alpha');

SELECT is(
  (
    SELECT banned_at
      FROM public.ban_host(
        'user_alpha',
        '00000000-0000-4000-8000-100000000001',
        '2026-07-29T20:04:00Z'
      )
  ),
  '2026-07-29 20:04:00+00'::timestamptz,
  'ban marks the host banned'
);

SELECT is(
  (SELECT status FROM public.review_runs WHERE id = (SELECT review_run_id FROM ban_review_claim)),
  'failed',
  'ban releases the host''s claimed review run'
);

SELECT is(
  (SELECT count(*)::integer FROM public.review_attempts WHERE review_cycle_id = (SELECT review_cycle_id FROM ban_review_claim)),
  0,
  'ban releasing a review run never consumes a Review Attempt'
);

SELECT is(
  (SELECT count(*)::integer FROM public.review_runs WHERE review_cycle_id = (SELECT review_cycle_id FROM ban_review_claim) AND status = 'pending'),
  1,
  'ban releasing a review run automatically retries it'
);

SELECT is(
  (
    SELECT last_seen_at
      FROM public.hosts
     WHERE id = '00000000-0000-4000-8000-100000000001'
  ),
  null,
  'ban revokes online presence before work can be reassigned'
);

SELECT is(
  (
    SELECT status
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-100000000001'
  ),
  'todo',
  'ban requeues active work'
);

SELECT is(
  (
    SELECT active_host_id
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-100000000001'
  ),
  null,
  'requeued issue has no old host lease'
);

SELECT is(
  (
    SELECT active_run_id
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-100000000001'
  ),
  null,
  'requeued issue has no old run lease'
);

SELECT is(
  (
    SELECT session_id
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-100000000001'
  ),
  'session-1',
  'requeued issue retains conversation session context'
);

SELECT is(
  (
    SELECT url
      FROM public.issue_pull_requests
     WHERE issue_id = '20000000-0000-4000-8000-100000000001'
  ),
  'https://github.com/gentic/alpha/pull/1',
  'requeued issue retains its Associated Pull Request'
);

SELECT is(
  (
    SELECT consumed_by_run_id
      FROM public.messages
     WHERE id = '40000000-0000-4000-8000-100000000001'
  ),
  null,
  'requeued user messages are not leased to the old run'
);

SELECT is(
  (
    SELECT status
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-100000000002'
  ),
  'run-failed',
  'ban does not retry already failed runs'
);

SELECT is(
  (
    SELECT active_run_id
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-100000000002'
  ),
  null,
  'failed run old lease is cleared'
);

SELECT is(
  (
    SELECT banned_at
      FROM public.unban_host(
        'user_alpha',
        '00000000-0000-4000-8000-100000000001',
        '2026-07-29T20:05:00Z'
      )
  ),
  null,
  'unban restores the host identity'
);

SELECT is(
  (
    SELECT credential_hash
      FROM public.hosts
     WHERE id = '00000000-0000-4000-8000-100000000001'
  ),
  repeat('a', 64),
  'unban leaves the original credential hash in place'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.issues
     WHERE active_host_id = '00000000-0000-4000-8000-100000000001'
        or active_run_id in (
          '30000000-0000-4000-8000-100000000001',
          '30000000-0000-4000-8000-100000000002'
        )
  ),
  0,
  'unban never restores previous leases'
);

UPDATE public.issues
   SET status = 'queued',
       active_host_id = '00000000-0000-4000-8000-100000000001',
       active_run_id = '30000000-0000-4000-8000-100000000003'
 WHERE id = '20000000-0000-4000-8000-100000000001';

SELECT ok(
  public.delete_host(
    'user_alpha',
    '00000000-0000-4000-8000-100000000001',
    '2026-07-29T20:06:00Z'
  ),
  'online delete succeeds'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.hosts
     WHERE id = '00000000-0000-4000-8000-100000000001'
  ),
  0,
  'delete hard-deletes the host record'
);

SELECT is(
  (
    SELECT status
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-100000000001'
  ),
  'todo',
  'online delete applies ban requeue semantics'
);

SELECT is(
  (
    SELECT active_run_id
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-100000000001'
  ),
  null,
  'online delete clears the old run lease'
);

SELECT is_empty(
  $$
    SELECT id
      FROM public.hosts
     WHERE user_id = 'user_alpha'
       and id = '00000000-0000-4000-8000-100000000001'
  $$,
  'deleted hosts disappear from normal reads'
);

UPDATE public.hosts
   SET last_seen_at = null
 WHERE id = '00000000-0000-4000-8000-100000000002';

UPDATE public.issues
   SET status = 'run-failed',
       active_host_id = '00000000-0000-4000-8000-100000000002',
       active_run_id = '30000000-0000-4000-8000-100000000004',
       run_error = 'offline failed'
 WHERE id = '20000000-0000-4000-8000-100000000002';

-- `priority = 'urgent'` (default is 'medium') so `claim_review_run`'s FIFO
-- queue (priority desc, created_at asc) hands this run to the claim below
-- instead of the ban scenario's still-pending, unclaimed retry above, which
-- is otherwise older and would win the tiebreak.
INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider, priority) VALUES
  ('20000000-0000-4000-8000-100000000004', '10000000-0000-4000-8000-100000000001', 'Review job task for delete', 'Body', 'ready-for-review', 4, 'claude_code', 'urgent');

INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('20000000-0000-4000-8000-100000000104', '20000000-0000-4000-8000-100000000004', 'https://github.com/gentic/alpha/pull/4', 'open', 'sha-delete', 'success');

SELECT public.evaluate_review_eligibility('https://github.com/gentic/alpha/pull/4');

CREATE TEMP TABLE delete_review_claim AS
SELECT * FROM public.claim_review_run('00000000-0000-4000-8000-100000000002', 'user_alpha');

SELECT ok(
  public.delete_host(
    'user_alpha',
    '00000000-0000-4000-8000-100000000002',
    '2026-07-29T20:07:00Z'
  ),
  'offline delete succeeds'
);

SELECT is(
  (SELECT status FROM public.review_runs WHERE id = (SELECT review_run_id FROM delete_review_claim)),
  'failed',
  'delete releases the host''s claimed review run'
);

SELECT is(
  (SELECT count(*)::integer FROM public.review_runs WHERE review_cycle_id = (SELECT review_cycle_id FROM delete_review_claim) AND status = 'pending'),
  1,
  'delete releasing a review run automatically retries it'
);

SELECT is(
  (
    SELECT status
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-100000000002'
  ),
  'run-failed',
  'offline delete does not retry run-failed work'
);

SELECT is(
  (
    SELECT run_error
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-100000000002'
  ),
  'offline failed',
  'offline delete preserves run-failed error context'
);

SELECT is(
  (
    SELECT active_host_id
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-100000000002'
  ),
  null,
  'offline delete clears failed host lease'
);

SELECT is(
  (
    SELECT active_run_id
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-100000000002'
  ),
  null,
  'offline delete clears failed run lease'
);

SELECT is(
  (
    SELECT id
      FROM public.ban_host(
        'user_alpha',
        '00000000-0000-4000-8000-100000000003',
        '2026-07-29T20:08:00Z'
      )
  ),
  null,
  'ban does not reveal another user host'
);

SELECT is(
  (
    SELECT id
      FROM public.unban_host(
        'user_alpha',
        '00000000-0000-4000-8000-100000000003',
        '2026-07-29T20:09:00Z'
      )
  ),
  null,
  'unban does not reveal another user host'
);

SELECT is(
  public.delete_host(
    'user_alpha',
    '00000000-0000-4000-8000-100000000003',
    '2026-07-29T20:10:00Z'
  ),
  false,
  'delete does not reveal another user host'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.hosts
     WHERE id = '00000000-0000-4000-8000-100000000003'
  ),
  1,
  'cross-user delete leaves the other host intact'
);

SELECT lives_ok(
  $$
    UPDATE public.issues
       SET status = 'in-progress',
           active_host_id = '00000000-0000-4000-8000-100000000001',
           active_run_id = '30000000-0000-4000-8000-100000000003'
     WHERE id = '20000000-0000-4000-8000-100000000001'
       AND active_host_id = '00000000-0000-4000-8000-100000000001'
       AND active_run_id = '30000000-0000-4000-8000-100000000003'
  $$,
  'stale run update after delete matches no active lease'
);

SELECT is(
  (
    SELECT status
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-100000000001'
  ),
  'todo',
  'stale run update after delete does not change requeued status'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.rename_host(text, uuid, text, timestamptz)',
    'EXECUTE'
  ),
  'authenticated role cannot directly invoke host lifecycle RPCs'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.rename_host(text, uuid, text, timestamptz)',
    'EXECUTE'
  ),
  'service role can invoke host lifecycle RPCs'
);

SELECT * FROM finish();
ROLLBACK;
