-- The browser holds an `authenticated` PostgREST client, so anything granted
-- to that role is directly callable with a crafted request. Two families of
-- object must never be reachable that way, and both were at one point:
--
--  * `github_integrations` writes. `installation_id` is a capability
--    reference — it decides which GitHub App installation Gentic mints tokens
--    for and whose webhooks resolve to which account — so it may only be
--    written by the callback route, after it has verified the installation
--    against `GET /user/installations`.
--  * SECURITY DEFINER RPCs that take the acting user as a `p_user_id`
--    argument. Bypassing RLS while authorizing on an argument means the
--    argument is the whole access check, and the caller supplies it.
BEGIN;
SELECT plan(12);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.github_integrations', priv),
  format('authenticated cannot %s github_integrations', priv)
) FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) AS priv;

SELECT ok(
  has_table_privilege('authenticated', 'public.github_integrations', 'SELECT'),
  'authenticated can still read its own integration through RLS'
);

SELECT ok(
  NOT has_table_privilege(
    'authenticated', 'public.github_integration_states', priv
  ),
  format('authenticated cannot %s github_integration_states', priv)
) FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) AS priv;

SELECT ok(
  NOT has_function_privilege('authenticated', fn, 'EXECUTE'),
  format('authenticated cannot execute %s', fn)
) FROM unnest(ARRAY[
  'public.start_fresh_implementation(text, uuid, timestamptz)',
  'public.continue_with_human_review(text, uuid, timestamptz)',
  'public.retry_review_run(text, uuid, timestamptz)'
]) AS fn;

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.start_fresh_implementation(text, uuid, timestamptz)',
    'EXECUTE'
  ),
  'service_role retains execute on the user-scoped review RPCs'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'github_integrations'
       AND cmd <> 'SELECT'
  ),
  0,
  'github_integrations has no write policies left for authenticated'
);

ROLLBACK;
