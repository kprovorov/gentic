BEGIN;
SELECT plan(8);

SELECT has_column(
  'public',
  'issues',
  'pinned_host_id',
  'issues carry a pinned host'
);

SELECT fk_ok(
  'public', 'issues', 'pinned_host_id',
  'public', 'hosts', 'id',
  'pinned_host_id references hosts'
);

INSERT INTO public.hosts (
  id,
  user_id,
  display_name,
  credential_hash,
  setup_state,
  last_seen_at,
  provider_capabilities
) VALUES (
  '00000000-0000-4000-8000-500000000001',
  'user_pin',
  'Pinned Host',
  repeat('a', 64),
  'ready',
  '2026-09-24T12:00:00Z',
  '{"providers":{}}'::jsonb
);

INSERT INTO public.projects (id, user_id, name, repo, key) VALUES (
  '10000000-0000-4000-8000-500000000001',
  'user_pin',
  'Pin Project',
  'gentic/pin',
  'PIN'
);

-- One pinned issue mid-run on the host, one pinned issue still waiting.
INSERT INTO public.issues (
  id,
  project_id,
  title,
  body,
  status,
  number,
  pinned_host_id,
  active_host_id,
  active_run_id
) VALUES (
  '20000000-0000-4000-8000-500000000001',
  '10000000-0000-4000-8000-500000000001',
  'Running pinned task',
  'Body',
  'in-progress',
  1,
  '00000000-0000-4000-8000-500000000001',
  '00000000-0000-4000-8000-500000000001',
  '30000000-0000-4000-8000-500000000001'
), (
  '20000000-0000-4000-8000-500000000002',
  '10000000-0000-4000-8000-500000000001',
  'Waiting pinned task',
  'Body',
  'todo',
  2,
  '00000000-0000-4000-8000-500000000001',
  null,
  null
);

SELECT is(
  (
    SELECT pinned_host_id
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-500000000002'
  ),
  '00000000-0000-4000-8000-500000000001'::uuid,
  'an issue stores the host it is pinned to'
);

SELECT lives_ok(
  $$
    SELECT public.ban_host(
      'user_pin',
      '00000000-0000-4000-8000-500000000001',
      '2026-09-24T12:01:00Z'
    )
  $$,
  'banning the pinned host succeeds'
);

SELECT is(
  (
    SELECT status
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-500000000001'
  ),
  'todo',
  'ban requeues the running pinned issue'
);

-- The pin is the user's standing choice, not part of the run lease the ban
-- releases, so it must outlive the ban (and the unban that may follow).
SELECT is(
  (
    SELECT count(*)::integer
      FROM public.issues
     WHERE pinned_host_id = '00000000-0000-4000-8000-500000000001'
  ),
  2,
  'ban keeps both issues pinned to the host'
);

SELECT ok(
  public.delete_host(
    'user_pin',
    '00000000-0000-4000-8000-500000000001',
    '2026-09-24T12:02:00Z'
  ),
  'deleting the pinned host succeeds'
);

-- Once the host row is gone there is nothing to pin to, so both issues fall
-- back to the shared queue rather than waiting for a host that will never
-- return.
SELECT is(
  (
    SELECT count(*)::integer
      FROM public.issues
     WHERE id IN (
       '20000000-0000-4000-8000-500000000001',
       '20000000-0000-4000-8000-500000000002'
     )
       AND pinned_host_id IS NULL
       AND status = 'todo'
  ),
  2,
  'delete unpins the host''s issues and leaves them queued for any host'
);

SELECT * FROM finish();
ROLLBACK;
