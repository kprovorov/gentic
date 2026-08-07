BEGIN;
SELECT plan(15);

SELECT has_table('public', 'workers', 'workers table exists');
SELECT has_table(
  'public',
  'worker_enrollment_codes',
  'worker enrollment codes table exists'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'worker_enrollment_codes'
       AND column_name IN ('code', 'raw_code', 'enrollment_code', 'token')
  ),
  'worker_enrollment_codes has no raw code column'
);

SELECT ok(
  NOT has_column_privilege(
    'authenticated',
    'public.workers',
    'credential_hash',
    'SELECT'
  ),
  'authenticated users cannot select worker credential hashes'
);

SELECT ok(
  NOT has_column_privilege(
    'authenticated',
    'public.worker_enrollment_codes',
    'code_hash',
    'SELECT'
  ),
  'authenticated users cannot select enrollment code hashes'
);

SELECT is(
  (SELECT count(*)::integer FROM public.workers),
  0,
  'fresh schema does not create or backfill a fake legacy worker'
);

INSERT INTO public.workers (
  id,
  user_id,
  display_name,
  credential_hash,
  setup_state,
  provider_capabilities
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  'user_alpha',
  'Alpha   Worker',
  repeat('a', 64),
  'ready',
  '{"providers":{"codex":{"enabled":true}}}'::jsonb
);

SELECT is(
  (
    SELECT normalized_name
      FROM public.workers
     WHERE id = '00000000-0000-4000-8000-000000000001'
  ),
  'alpha worker',
  'workers normalize display names for case-insensitive uniqueness'
);

SELECT throws_ok(
  $$
    INSERT INTO public.workers (
      user_id,
      display_name,
      credential_hash,
      provider_capabilities
    ) VALUES (
      'user_alpha',
      'alpha worker',
      repeat('b', 64),
      '{"providers":{}}'::jsonb
    )
  $$,
  '23505',
  null,
  'duplicate normalized worker names are rejected for the same owner'
);

INSERT INTO public.workers (
  id,
  user_id,
  display_name,
  credential_hash,
  provider_capabilities
) VALUES (
  '00000000-0000-4000-8000-000000000002',
  'user_beta',
  'ALPHA WORKER',
  repeat('c', 64),
  '{"providers":{}}'::jsonb
);

SELECT is(
  (SELECT count(*)::integer FROM public.workers),
  2,
  'different owners can reuse normalized worker names'
);

INSERT INTO public.worker_enrollment_codes (
  code_hash,
  user_id,
  created_at,
  expires_at
) VALUES (
  repeat('1', 64),
  'user_alpha',
  '2026-07-29T00:00:00Z',
  '2026-07-29T01:00:00Z'
);

INSERT INTO public.worker_enrollment_codes (
  code_hash,
  user_id,
  created_at,
  expires_at
) VALUES (
  repeat('2', 64),
  'user_alpha',
  '2026-07-29T02:00:00Z',
  '2026-07-29T03:00:00Z'
);

SELECT throws_ok(
  $$
    INSERT INTO public.worker_enrollment_codes (
      code_hash,
      user_id,
      created_at,
      expires_at
    ) VALUES (
      repeat('3', 64),
      'user_alpha',
      '2026-07-29T02:30:00Z',
      '2026-07-29T03:30:00Z'
    )
  $$,
  '23P01',
  null,
  'overlapping unconsumed enrollment codes are rejected per user'
);

UPDATE public.worker_enrollment_codes
   SET consumed_at = '2026-07-29T02:05:00Z'
 WHERE code_hash = repeat('2', 64);

INSERT INTO public.worker_enrollment_codes (
  code_hash,
  user_id,
  created_at,
  expires_at
) VALUES (
  repeat('4', 64),
  'user_alpha',
  '2026-07-29T02:30:00Z',
  '2026-07-29T03:30:00Z'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.worker_enrollment_codes
     WHERE user_id = 'user_alpha'
  ),
  3,
  'consumed enrollment codes no longer block a new active code'
);

INSERT INTO public.projects (
  id,
  user_id,
  name,
  repo,
  key
) VALUES (
  '10000000-0000-4000-8000-000000000001',
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
  active_worker_id,
  active_run_id
) VALUES (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Use a worker',
  'Body',
  'in-progress',
  1,
  '00000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
);

SELECT is(
  (
    SELECT active_worker_id::text
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-000000000001'
  ),
  '00000000-0000-4000-8000-000000000001',
  'issues can reference a worker owned by the issue owner'
);

SELECT throws_ok(
  $$
    UPDATE public.issues
       SET active_worker_id = '00000000-0000-4000-8000-000000000002'
     WHERE id = '20000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'issues cannot reference a worker owned by another user'
);

DELETE FROM public.workers
 WHERE id = '00000000-0000-4000-8000-000000000001';

SELECT ok(
  (
    SELECT active_worker_id IS NULL
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-000000000001'
  ),
  'deleting a worker preserves the issue and clears active_worker_id'
);

SELECT is(
  (SELECT count(*)::integer FROM public.workers),
  1,
  'deleting one assigned worker leaves only explicitly inserted workers'
);

SELECT * FROM finish();
ROLLBACK;
