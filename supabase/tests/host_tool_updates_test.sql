BEGIN;
SELECT plan(12);

SELECT has_table('public', 'host_tool_updates', 'host tool updates table exists');

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.host_tool_updates', 'SELECT'),
  'authenticated users cannot read tool update commands directly'
);

SELECT ok(
  (
    SELECT relrowsecurity
      FROM pg_class
     WHERE oid = 'public.host_tool_updates'::regclass
  ),
  'host_tool_updates has row level security enabled'
);

INSERT INTO public.hosts (id, user_id, display_name, credential_hash, setup_state)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'user_alpha', 'Alpha', repeat('a', 64), 'ready'),
  ('00000000-0000-4000-8000-000000000002', 'user_beta', 'Beta', repeat('b', 64), 'ready');

-- A command's user_id can never drift from the owner of the host it targets.
SELECT throws_ok(
  $$
    INSERT INTO public.host_tool_updates (user_id, host_id, tool, expires_at)
    VALUES ('user_beta', '00000000-0000-4000-8000-000000000001', 'gentic', now() + interval '30 minutes')
  $$,
  '23503',
  NULL,
  'a tool update cannot name a host owned by another account'
);

SELECT throws_ok(
  $$
    INSERT INTO public.host_tool_updates (user_id, host_id, tool, expires_at)
    VALUES ('user_alpha', '00000000-0000-4000-8000-000000000001', 'helm', now() + interval '30 minutes')
  $$,
  '23514',
  NULL,
  'only the four managed tools can be requested'
);

SELECT throws_ok(
  $$
    INSERT INTO public.host_tool_updates (user_id, host_id, tool, status, expires_at)
    VALUES ('user_alpha', '00000000-0000-4000-8000-000000000001', 'gentic', 'running', now() + interval '30 minutes')
  $$,
  '23514',
  NULL,
  'status is constrained to the command lifecycle'
);

INSERT INTO public.host_tool_updates (id, user_id, host_id, tool, expires_at)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'user_alpha', '00000000-0000-4000-8000-000000000001', 'github', now() + interval '30 minutes'),
  ('10000000-0000-4000-8000-000000000002', 'user_alpha', '00000000-0000-4000-8000-000000000001', 'codex', now() + interval '30 minutes');

SELECT is(
  (SELECT count(*)::integer FROM public.host_tool_updates WHERE host_id = '00000000-0000-4000-8000-000000000001'),
  2,
  'several different tools may be queued for one host'
);

SELECT throws_ok(
  $$
    INSERT INTO public.host_tool_updates (user_id, host_id, tool, expires_at)
    VALUES ('user_alpha', '00000000-0000-4000-8000-000000000001', 'github', now() + interval '30 minutes')
  $$,
  '23505',
  NULL,
  'the same tool cannot be queued twice while one command is pending'
);

UPDATE public.host_tool_updates
   SET status = 'updating', accepted_at = now()
 WHERE id = '10000000-0000-4000-8000-000000000001';

SELECT throws_ok(
  $$
    UPDATE public.host_tool_updates
       SET status = 'updating', accepted_at = now()
     WHERE id = '10000000-0000-4000-8000-000000000002'
  $$,
  '23505',
  NULL,
  'a host runs at most one update at a time'
);

UPDATE public.host_tool_updates
   SET status = 'updated', finished_at = now(), version = '2.61.0'
 WHERE id = '10000000-0000-4000-8000-000000000001';

SELECT lives_ok(
  $$
    UPDATE public.host_tool_updates
       SET status = 'updating', accepted_at = now()
     WHERE id = '10000000-0000-4000-8000-000000000002'
  $$,
  'the next queued command can start once the previous one finished'
);

SELECT lives_ok(
  $$
    INSERT INTO public.host_tool_updates (user_id, host_id, tool, expires_at)
    VALUES ('user_alpha', '00000000-0000-4000-8000-000000000001', 'github', now() + interval '30 minutes')
  $$,
  'a finished tool can be queued again'
);

DELETE FROM public.hosts WHERE id = '00000000-0000-4000-8000-000000000001';

SELECT is(
  (SELECT count(*)::integer FROM public.host_tool_updates),
  0,
  'deleting a host removes its tool update commands'
);

SELECT * FROM finish();
ROLLBACK;
