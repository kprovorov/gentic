BEGIN;
SELECT plan(24);

SELECT has_column(
  'public',
  'issues',
  'create_pr_automatically',
  'issues has create_pr_automatically'
);
SELECT has_column(
  'public',
  'issues',
  'has_unpublished_agent_changes',
  'issues has unpublished agent changes flag'
);
SELECT has_column(
  'public',
  'messages',
  'author_type',
  'messages has author metadata'
);
SELECT has_column(
  'public',
  'messages',
  'generated_action',
  'messages has generated action metadata'
);
SELECT has_table(
  'public',
  'issue_automatic_pr_requests',
  'automatic PR request table exists'
);

INSERT INTO public.projects (
  id,
  user_id,
  name,
  repo,
  key
) VALUES (
  '10000000-0000-4000-8000-000000000101',
  'user_alpha',
  'Alpha Project',
  'gentic/alpha',
  'ALP'
), (
  '10000000-0000-4000-8000-000000000102',
  'user_beta',
  'Beta Project',
  'gentic/beta',
  'BET'
);

INSERT INTO public.issues (
  id,
  project_id,
  title,
  prompt,
  status,
  number
) VALUES (
  '20000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000101',
  'Default issue',
  'Prompt',
  'draft',
  1
);

SELECT is(
  (
    SELECT create_pr_automatically
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-000000000101'
  ),
  false,
  'new issues default create_pr_automatically to false'
);
SELECT is(
  (
    SELECT has_unpublished_agent_changes
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-000000000101'
  ),
  false,
  'new issues default has_unpublished_agent_changes to false'
);

INSERT INTO public.messages (
  id,
  issue_id,
  role,
  content
) VALUES (
  '30000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  'user',
  'User prompt'
), (
  '30000000-0000-4000-8000-000000000102',
  '20000000-0000-4000-8000-000000000101',
  'assistant',
  'Agent response'
);

SELECT is(
  (
    SELECT author_type
      FROM public.messages
     WHERE id = '30000000-0000-4000-8000-000000000101'
  ),
  'user',
  'user-role messages remain user-authored by default'
);
SELECT is(
  (
    SELECT generated_action
      FROM public.messages
     WHERE id = '30000000-0000-4000-8000-000000000101'
  ),
  null,
  'existing-style messages have no generated action by default'
);
SELECT is(
  (
    SELECT author_type
      FROM public.messages
     WHERE id = '30000000-0000-4000-8000-000000000102'
  ),
  'agent',
  'assistant messages without explicit metadata are agent-authored'
);

SELECT throws_ok(
  $$
    INSERT INTO public.messages (
      issue_id,
      role,
      content,
      author_type
    ) VALUES (
      '20000000-0000-4000-8000-000000000101',
      'system',
      'Bad author',
      'robot'
    )
  $$,
  '23514',
  'invalid message author metadata is rejected'
);

SELECT throws_ok(
  $$
    INSERT INTO public.messages (
      issue_id,
      role,
      content,
      generated_action
    ) VALUES (
      '20000000-0000-4000-8000-000000000101',
      'system',
      'Bad action',
      'merge_pr'
    )
  $$,
  '23514',
  'invalid generated action metadata is rejected'
);

UPDATE public.issues
   SET create_pr_automatically = true,
       active_run_id = '40000000-0000-4000-8000-000000000101'
 WHERE id = '20000000-0000-4000-8000-000000000101';

INSERT INTO public.messages (
  id,
  issue_id,
  role,
  content,
  author_type,
  generated_action
) VALUES (
  '30000000-0000-4000-8000-000000000103',
  '20000000-0000-4000-8000-000000000101',
  'system',
  'Create a pull request.',
  'gentic',
  'create_pr'
);

INSERT INTO public.issue_automatic_pr_requests (
  id,
  issue_id,
  run_id,
  requested_by_message_id
) VALUES (
  '50000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '40000000-0000-4000-8000-000000000101',
  '30000000-0000-4000-8000-000000000103'
);

SELECT is(
  (
    SELECT create_pr_automatically_snapshot
      FROM public.issue_automatic_pr_requests
     WHERE id = '50000000-0000-4000-8000-000000000101'
  ),
  true,
  'request snapshots the issue create_pr_automatically value'
);

UPDATE public.issues
   SET create_pr_automatically = false
 WHERE id = '20000000-0000-4000-8000-000000000101';

SELECT is(
  (
    SELECT create_pr_automatically_snapshot
      FROM public.issue_automatic_pr_requests
     WHERE id = '50000000-0000-4000-8000-000000000101'
  ),
  true,
  'request snapshot is preserved when the issue opt-in changes later'
);
SELECT is(
  (
    SELECT create_pr_automatically
      FROM public.issues
     WHERE id = '20000000-0000-4000-8000-000000000101'
  ),
  false,
  'request attempts do not consume the issue opt-in value'
);

SELECT throws_ok(
  $$
    INSERT INTO public.issue_automatic_pr_requests (
      issue_id,
      run_id
    ) VALUES (
      '20000000-0000-4000-8000-000000000101',
      '40000000-0000-4000-8000-000000000101'
    )
  $$,
  '23505',
  'only one automatic PR request is allowed for a run'
);

SELECT throws_ok(
  $$
    INSERT INTO public.issue_automatic_pr_requests (
      issue_id,
      run_id
    ) VALUES (
      '20000000-0000-4000-8000-000000000101',
      '40000000-0000-4000-8000-000000000102'
    )
  $$,
  '23514',
  'automatic PR requests must target the active run'
);

UPDATE public.issues
   SET active_run_id = '40000000-0000-4000-8000-000000000102'
 WHERE id = '20000000-0000-4000-8000-000000000101';

INSERT INTO public.issue_automatic_pr_requests (
  issue_id,
  run_id
) VALUES (
  '20000000-0000-4000-8000-000000000101',
  '40000000-0000-4000-8000-000000000102'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.issue_automatic_pr_requests
     WHERE issue_id = '20000000-0000-4000-8000-000000000101'
  ),
  2,
  'a later run can attempt automatic PR creation again'
);

UPDATE public.issues
   SET active_run_id = null
 WHERE id = '20000000-0000-4000-8000-000000000101';

UPDATE public.issue_automatic_pr_requests
   SET status = 'completed'
 WHERE id = '50000000-0000-4000-8000-000000000101';

SELECT is(
  (
    SELECT status
      FROM public.issue_automatic_pr_requests
     WHERE id = '50000000-0000-4000-8000-000000000101'
  ),
  'completed',
  'request status can be updated after the run is no longer active'
);

SELECT ok(
  has_table_privilege(
    'authenticated',
    'public.issue_automatic_pr_requests',
    'SELECT'
  ),
  'authenticated users can select automatic PR requests through RLS'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'public.issue_automatic_pr_requests',
    'INSERT'
  ),
  'authenticated users cannot insert automatic PR requests'
);
SELECT ok(
  has_table_privilege(
    'service_role',
    'public.issue_automatic_pr_requests',
    'INSERT'
  ),
  'service role can insert automatic PR requests'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"user_alpha"}', true);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.issue_automatic_pr_requests
  ),
  2,
  'issue owner can read automatic PR requests'
);

SELECT set_config('request.jwt.claims', '{"sub":"user_beta"}', true);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.issue_automatic_pr_requests
  ),
  0,
  'other users cannot read automatic PR requests'
);

SELECT * FROM finish();
ROLLBACK;
