BEGIN;
SELECT plan(8);

SELECT ok(
  EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.github_integrations'::regclass
       AND conname = 'github_integrations_installation_id_unique'
       AND contype = 'u'
  ),
  'GitHub installation ownership has a database uniqueness constraint'
);

INSERT INTO public.github_integrations (
  id,
  user_id,
  installation_id,
  status,
  connected_at
) VALUES (
  '10000000-0000-4000-8000-000000000601',
  'user_alpha',
  'installation_123',
  'connected',
  '2026-08-05T12:00:00Z'
);

SELECT lives_ok(
  $$
    INSERT INTO public.github_integrations (
      user_id,
      installation_id,
      status,
      connected_at
    ) VALUES (
      'user_alpha',
      'installation_123',
      'connected',
      '2026-08-05T12:05:00Z'
    )
    ON CONFLICT (user_id) DO UPDATE SET
      installation_id = excluded.installation_id,
      status = excluded.status,
      connected_at = excluded.connected_at
  $$,
  'the existing owner can reconnect the same installation'
);

SELECT is(
  (
    SELECT id
      FROM public.github_integrations
     WHERE user_id = 'user_alpha'
  ),
  '10000000-0000-4000-8000-000000000601'::uuid,
  'reconnecting preserves the existing integration row'
);

SELECT throws_ok(
  $$
    INSERT INTO public.github_integrations (
      user_id,
      installation_id,
      status,
      connected_at
    ) VALUES (
      'user_beta',
      'installation_123',
      'connected',
      '2026-08-05T12:06:00Z'
    )
    ON CONFLICT (user_id) DO UPDATE SET
      installation_id = excluded.installation_id,
      status = excluded.status,
      connected_at = excluded.connected_at
  $$,
  '23505',
  null,
  'a competing account cannot claim an owned installation'
);

SELECT is(
  (
    SELECT user_id
      FROM public.github_integrations
     WHERE installation_id = 'installation_123'
  ),
  'user_alpha',
  'a rejected claim does not change the existing owner'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.github_integrations
     WHERE user_id = 'user_beta'
  ),
  0,
  'a rejected claim does not create an integration for the competing account'
);

INSERT INTO public.github_integrations (
  user_id,
  installation_id,
  status,
  connected_at
) VALUES (
  'user_beta',
  'installation_456',
  'connected',
  '2026-08-05T12:07:00Z'
);

SELECT is(
  (SELECT count(*)::integer FROM public.github_integrations),
  2,
  'different installations can belong to different accounts'
);

SELECT is(
  (
    SELECT count(DISTINCT user_id)::integer
      FROM public.github_integrations
     WHERE installation_id = 'installation_123'
  ),
  1,
  'each installation resolves to exactly one Gentic account'
);

ROLLBACK;
