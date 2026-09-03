BEGIN;
SELECT plan(15);

SELECT has_table('public', 'hosts', 'hosts table exists');
SELECT has_table(
  'public',
  'host_enrollment_codes',
  'host enrollment codes table exists'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'host_enrollment_codes'
       AND column_name IN ('code', 'raw_code', 'enrollment_code', 'token')
  ),
  'host_enrollment_codes has no raw code column'
);

SELECT ok(
  NOT has_column_privilege(
    'authenticated',
    'public.hosts',
    'credential_hash',
    'SELECT'
  ),
  'authenticated users cannot select host credential hashes'
);

SELECT ok(
  NOT has_column_privilege(
    'authenticated',
    'public.host_enrollment_codes',
    'code_hash',
    'SELECT'
  ),
  'authenticated users cannot select enrollment code hashes'
);

SELECT is(
  (SELECT count(*)::integer FROM public.hosts),
  0,
  'fresh schema does not create or backfill a fake legacy host'
);

INSERT INTO public.hosts (
  id,
  user_id,
  display_name,
  credential_hash,
  setup_state,
  provider_capabilities
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  'user_alpha',
  'Alpha   Host',
  repeat('a', 64),
  'ready',
  '{"providers":{"codex":{"enabled":true}}}'::jsonb
);

SELECT is(
  (
    SELECT normalized_name
      FROM public.hosts
     WHERE id = '00000000-0000-4000-8000-000000000001'
  ),
  'alpha host',
  'hosts normalize display names for case-insensitive uniqueness'
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
      'alpha host',
      repeat('b', 64),
      '{"providers":{}}'::jsonb
    )
  $$,
  '23505',
  null,
  'duplicate normalized host names are rejected for the same owner'
);

INSERT INTO public.hosts (
  id,
  user_id,
  display_name,
  credential_hash,
  provider_capabilities
) VALUES (
  '00000000-0000-4000-8000-000000000002',
  'user_beta',
  'ALPHA HOST',
  repeat('c', 64),
  '{"providers":{}}'::jsonb
);

SELECT is(
  (SELECT count(*)::integer FROM public.hosts),
  2,
  'different owners can reuse normalized host names'
);

INSERT INTO public.host_enrollment_codes (
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

INSERT INTO public.host_enrollment_codes (
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
    INSERT INTO public.host_enrollment_codes (
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

UPDATE public.host_enrollment_codes
   SET consumed_at = '2026-07-29T02:05:00Z'
 WHERE code_hash = repeat('2', 64);

INSERT INTO public.host_enrollment_codes (
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
      FROM public.host_enrollment_codes
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
  active_host_id,
  active_run_id
) VALUES (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Use a host',
  'Body',
  'in-progress',
  1,
  '00000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
);

SELECT is(
  (
    SELECT active_host_id::text
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-000000000001'
  ),
  '00000000-0000-4000-8000-000000000001',
  'issues can reference a host owned by the issue owner'
);

SELECT throws_ok(
  $$
    UPDATE public.issues
       SET active_host_id = '00000000-0000-4000-8000-000000000002'
     WHERE id = '20000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'issues cannot reference a host owned by another user'
);

DELETE FROM public.hosts
 WHERE id = '00000000-0000-4000-8000-000000000001';

SELECT ok(
  (
    SELECT active_host_id IS NULL
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-000000000001'
  ),
  'deleting a host preserves the issue and clears active_host_id'
);

SELECT is(
  (SELECT count(*)::integer FROM public.hosts),
  1,
  'deleting one assigned host leaves only explicitly inserted hosts'
);

SELECT * FROM finish();
ROLLBACK;
